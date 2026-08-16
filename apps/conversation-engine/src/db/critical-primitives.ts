/**
 * The four database primitives the correctness of Wafa rests on.
 *
 * Every one of them appears in a sequence diagram (Blueprint §6) and in an NFR.
 * They are collected in one file because they are also the entire technical
 * argument for the ORM decision in docs/ADR-001-orm.md: in Drizzle all four are
 * first-class and typed; in Prisma three of the four are $queryRaw, which means
 * the least type-safe code in the codebase would sit exactly where a mistake
 * costs a customer money.
 *
 * Do not reimplement these inline elsewhere. Import them.
 */
import { sql, and, eq, inArray, lt, isNotNull } from 'drizzle-orm';
import type { TenantTx } from './types.js';
import { orders, conversationSessions, processedWebhookEvents } from '@wafa/shared';

// ---------------------------------------------------------------------------
// 1. EVENT-LEVEL IDEMPOTENCY — the unified dedup gate
//    Blueprint §5.6 layer 1, diagram 6.3, NFR-04.
//
//    Returns true if THIS call is the one that claimed the event. Every
//    redelivery returns false and must be answered 200 OK and dropped.
//
//    ON CONFLICT DO NOTHING ... RETURNING is the whole trick: it collapses
//    "check if processed" and "mark processed" into one atomic statement, so two
//    redeliveries arriving a millisecond apart cannot both win. A SELECT-then-
//    INSERT would let both through.
//
//    Prisma equivalent: none. createMany({skipDuplicates}) returns a count, not
//    which rows were inserted, and there is no RETURNING on conflict. This is a
//    $executeRawUnsafe in Prisma.
// ---------------------------------------------------------------------------
export async function claimWebhookEvent(
  tx: TenantTx,
  eventId: string,
  source: 'whatsapp' | 'payment_gateway',
): Promise<boolean> {
  const claimed = await tx
    .insert(processedWebhookEvents)
    .values({ eventId, source })
    .onConflictDoNothing({ target: [processedWebhookEvents.eventId, processedWebhookEvents.source] })
    .returning({ id: processedWebhookEvents.id });

  return claimed.length === 1;
}

// ---------------------------------------------------------------------------
// 2. ACTION-LEVEL IDEMPOTENCY — compare-and-swap on session state
//    Blueprint §5.6 layer 2, diagrams 6.1/6.2, NFR-04 ("atomic, conditional
//    state updates rather than a read-then-write check").
//
//    Layer 1 stops the SAME event being processed twice. This stops a LEGITIMATE
//    action being performed twice — the customer tapping "confirm" twice sends
//    two genuinely distinct webhooks with distinct message_ids, so layer 1 lets
//    both through by design. Only the first UPDATE matches `expected`.
//
//    The two layers do not substitute for each other. Removing either one
//    reopens a different duplicate-order path.
// ---------------------------------------------------------------------------
export async function advanceSessionState(
  tx: TenantTx,
  sessionId: string,
  expected: string,
  next: string,
): Promise<boolean> {
  const updated = await tx
    .update(conversationSessions)
    .set({ state: next as never, lastMessageAt: new Date() })
    .where(and(eq(conversationSessions.id, sessionId), eq(conversationSessions.state, expected as never)))
    .returning({ id: conversationSessions.id });

  return updated.length === 1;
}

// ---------------------------------------------------------------------------
// 3. ROW LOCK — SELECT ... FOR UPDATE
//    Blueprint §5.6 ("Race إلغاء المطعم مقابل webhook دفع"), diagrams 6.2/6.4-د,
//    FR-13 Exception Flow.
//
//    The scenario: staff cancel an order in the dashboard at the same instant
//    the gateway confirms payment for it. Without the lock both paths read
//    "not yet refunded" and both fire a refund — the restaurant pays the
//    customer twice. With it, whichever arrives second re-reads the committed
//    state and the refund invariant fires exactly once.
//
//    Prisma equivalent: none. Open feature request since 2021
//    (github.com/prisma/prisma/issues/8580). $queryRaw only.
// ---------------------------------------------------------------------------
export async function lockOrderForUpdate(tx: TenantTx, orderId: string) {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
  return order ?? null;
}

export async function lockOrderByGatewayRef(tx: TenantTx, gatewayRef: string) {
  const [order] = await tx
    .select()
    .from(orders)
    .where(eq(orders.paymentGatewayRef, gatewayRef))
    .for('update');
  return order ?? null;
}

// ---------------------------------------------------------------------------
// 4. SCHEDULER CLAIM — FOR UPDATE SKIP LOCKED
//    Blueprint §6.4 parts ب-١ and ب-٢.
//
//    SKIP LOCKED is what allows more than one scheduler instance to run without
//    coordination: each grabs a disjoint set of rows instead of queueing behind
//    the same lock. Drop it and a second instance either blocks or double-
//    processes, depending on how the query was written.
//
//    Both jobs re-assert their precondition inside the UPDATE (`AND status =
//    'ready'` / `AND payment_status = 'pending_online'`) rather than trusting the
//    SELECT: rowcount 0 means the state changed under us — a payment landed in
//    the same instant — and the row must be left alone, not forced.
//
//    Prisma equivalent: none. $queryRaw only.
// ---------------------------------------------------------------------------

/** Pickup orders that entered `ready` more than 24h ago and were never collected. */
export async function claimExpiredPickups(tx: TenantTx, limit = 100) {
  return tx
    .select({ id: orders.id, paymentStatus: orders.paymentStatus })
    .from(orders)
    .where(
      and(
        eq(orders.fulfillmentType, 'pickup'),
        eq(orders.status, 'ready'),
        isNotNull(orders.readyAt),
        // orders.ready_at, not order_status_history — see ADR-002.
        lt(orders.readyAt, sql`now() - interval '24 hours'`),
      ),
    )
    .limit(limit)
    .for('update', { skipLocked: true });
}

/** Online orders stuck unpaid for more than 2h. Cancelled, never refunded — no money arrived. */
export async function claimStuckOnlinePayments(tx: TenantTx, limit = 100) {
  return tx
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.paymentStatus, 'pending_online'),
        inArray(orders.status, ['pending_acceptance', 'accepted', 'preparing', 'ready']),
        lt(orders.createdAt, sql`now() - interval '2 hours'`),
      ),
    )
    .limit(limit)
    .for('update', { skipLocked: true });
}

// ---------------------------------------------------------------------------
// The refund invariant, stated once so it can be referenced rather than retyped:
//
//   Any order that enters `cancelled` or `expired` while payment_status = 'paid'
//   must be refunded exactly once — and the refund fires inside whichever
//   handler observes the condition first, including the payment webhook itself
//   when it is the late arrival (Blueprint §5.6, the bug found in design review).
//
// Enforce it in code AND assert it in a nightly reconciliation query. Anything
// this query ever returns is money owed to a customer that was not sent back:
//
//   SELECT id FROM orders
//    WHERE status IN ('cancelled','expired') AND payment_status = 'paid';
// ---------------------------------------------------------------------------
