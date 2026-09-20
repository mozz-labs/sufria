// Empirical check that the four primitives in critical-primitives.ts actually
// compile and execute against real PostgreSQL through Drizzle — rather than
// being taken on faith from the docs.
//
// Section 6 extends the same discipline to the CHECK constraints added in
// 0010: they are the safety net order creation leans on (task C brief §8), and
// a constraint nobody has watched reject anything is a comment, not a net.
import { drizzle } from "drizzle-orm/node-postgres";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigserial,
  numeric,
  boolean,
  integer,
  pgEnum,
} from "drizzle-orm/pg-core";
import { sql, and, eq, inArray, lt, isNotNull } from "drizzle-orm";
import { Pool } from "pg";

const webhookSource = pgEnum("webhook_source", ["whatsapp", "payment_gateway"]);
const orderStatus = pgEnum("order_status", [
  "pending_acceptance",
  "accepted",
  "preparing",
  "ready",
  "completed",
  "cancelled",
  "expired",
]);
const paymentStatus = pgEnum("payment_status", [
  "pending_cash",
  "pending_online",
  "paid",
  "collected",
  "refunded",
]);
const fulfillmentType = pgEnum("fulfillment_type", ["pickup", "delivery"]);
const paymentMethod = pgEnum("payment_method", ["online", "cash"]);
const convState = pgEnum("conversation_state", [
  "new",
  "browsing",
  "cart_review",
  "fulfillment_choice",
  "awaiting_payment",
  "order_placed",
  "abandoned",
]);

const processedWebhookEvents = pgTable("processed_webhook_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  eventId: text("event_id").notNull(),
  source: webhookSource("source").notNull(),
});

const orders = pgTable("orders", {
  id: uuid("id").primaryKey(),
  restaurantId: uuid("restaurant_id").notNull(),
  fulfillmentType: fulfillmentType("fulfillment_type").notNull(),
  paymentMethod: paymentMethod("payment_method").notNull(),
  status: orderStatus("status").notNull(),
  paymentStatus: paymentStatus("payment_status").notNull(),
  paymentGatewayRef: text("payment_gateway_ref"),
  readyAt: timestamp("ready_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  total: numeric("total").notNull(),
  notified: boolean("notified").notNull(),
  outboundMsgCount: integer("outbound_msg_count").notNull(),
});

const conversationSessions = pgTable("conversation_sessions", {
  id: uuid("id").primaryKey(),
  state: convState("state").notNull(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull(),
});

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// Every statement against a restaurant-scoped table must carry tenant
// context — exactly as TenantDbService does in production:
// set_config(..., true) is transaction-local. Without it this test only
// passes when the connecting role bypasses RLS (a superuser), which is
// precisely what hid the defect: CI ran as postgres.
const RID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const withTenant = (tx: { execute: (q: unknown) => Promise<unknown> }) =>
  tx.execute(sql`SELECT set_config('app.current_restaurant_id', ${RID}, true)`);

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};

async function main() {
  console.log(
    "verifying the four critical primitives against PostgreSQL 16 via drizzle-orm\n",
  );

  // --- 1. ON CONFLICT DO NOTHING ... RETURNING (event-level dedup) ---------
  await db.execute(
    sql`DELETE FROM processed_webhook_events WHERE event_id = 'wamid.TEST'`,
  );
  const first = await db
    .insert(processedWebhookEvents)
    .values({ eventId: "wamid.TEST", source: "whatsapp" })
    .onConflictDoNothing({
      target: [processedWebhookEvents.eventId, processedWebhookEvents.source],
    })
    .returning({ id: processedWebhookEvents.id });
  const second = await db
    .insert(processedWebhookEvents)
    .values({ eventId: "wamid.TEST", source: "whatsapp" })
    .onConflictDoNothing({
      target: [processedWebhookEvents.eventId, processedWebhookEvents.source],
    })
    .returning({ id: processedWebhookEvents.id });
  check("1. dedup gate: first delivery claims the event", first.length === 1);
  check(
    "1. dedup gate: redelivery is rejected",
    second.length === 0,
    `rows=${second.length}`,
  );

  // Same event id, different source, must be independent
  const other = await db
    .insert(processedWebhookEvents)
    .values({ eventId: "wamid.TEST", source: "payment_gateway" })
    .onConflictDoNothing({
      target: [processedWebhookEvents.eventId, processedWebhookEvents.source],
    })
    .returning({ id: processedWebhookEvents.id });
  check(
    "1. dedup gate: (event_id, source) is the key, not event_id alone",
    other.length === 1,
  );

  // --- 2. compare-and-swap on state ---------------------------------------
  const sid = "77777777-7777-4777-8777-777777777777";
  const [cas1, cas2] = await db.transaction(async (tx) => {
    await withTenant(tx);
    await tx.execute(sql`DELETE FROM conversation_sessions WHERE id = ${sid}`);
    await tx.execute(sql`
    INSERT INTO conversation_sessions (id, restaurant_id, customer_id, state, last_message_at)
    VALUES (${sid}, ${RID}, 'c0000000-0000-4000-8000-00000000000a', 'fulfillment_choice', now())`);

    const a = await tx
      .update(conversationSessions)
      .set({ state: "order_placed", lastMessageAt: new Date() })
      .where(
        and(
          eq(conversationSessions.id, sid),
          eq(conversationSessions.state, "fulfillment_choice"),
        ),
      )
      .returning({ id: conversationSessions.id });
    const b = await tx
      .update(conversationSessions)
      .set({ state: "order_placed", lastMessageAt: new Date() })
      .where(
        and(
          eq(conversationSessions.id, sid),
          eq(conversationSessions.state, "fulfillment_choice"),
        ),
      )
      .returning({ id: conversationSessions.id });
    return [a, b];
  });
  check("2. CAS: first confirm tap wins", cas1.length === 1);
  check(
    "2. CAS: double-tap produces no second order",
    cas2.length === 0,
    `rows=${cas2.length}`,
  );

  // --- 3. SELECT ... FOR UPDATE -------------------------------------------
  const forUpdateSql = db
    .select()
    .from(orders)
    .where(eq(orders.id, "00000000-0000-4000-8000-000000000000"))
    .for("update")
    .toSQL().sql;
  check(
    "3. row lock: FOR UPDATE emitted",
    /for update/i.test(forUpdateSql),
    forUpdateSql.slice(-24),
  );

  await db.transaction(async (tx) => {
    await withTenant(tx);
    const rows = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.id, "f0000000-0000-4000-8000-00000000000a"))
      .for("update");
    check("3. row lock: executes and returns the row", rows.length === 1);
  });

  // --- 4. FOR UPDATE SKIP LOCKED ------------------------------------------
  const skipSql = db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.status, "ready"),
        isNotNull(orders.readyAt),
        lt(orders.readyAt, sql`now() - interval '24 hours'`),
      ),
    )
    .limit(100)
    .for("update", { skipLocked: true })
    .toSQL().sql;
  check(
    "4. scheduler claim: SKIP LOCKED emitted",
    /skip locked/i.test(skipSql),
    skipSql.slice(-32),
  );

  const stuckSql = db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.paymentStatus, "pending_online"),
        inArray(orders.status, [
          "pending_acceptance",
          "accepted",
          "preparing",
          "ready",
        ]),
        lt(orders.createdAt, sql`now() - interval '2 hours'`),
      ),
    )
    .limit(100)
    .for("update", { skipLocked: true })
    .toSQL().sql;
  check(
    "4. scheduler claim: 2h payment-timeout query builds",
    /skip locked/i.test(stuckSql),
  );

  // Two concurrent workers must claim disjoint sets, not block each other.
  // The fixture holds one order per restaurant, and this check needs two
  // rows visible inside the same tenant boundary — so add a temporary
  // order for the same restaurant and remove it afterwards.
  const TMP = "f0000000-0000-4000-8000-0000000000aa";
  await db.transaction(async (tx) => {
    await withTenant(tx);
    await tx.execute(sql`
      INSERT INTO orders (id, restaurant_id, customer_id, fulfillment_type,
                          payment_method, status, payment_status, subtotal, total, ready_at)
      VALUES (${TMP}, ${RID}, 'c0000000-0000-4000-8000-00000000000a', 'pickup',
              'cash', 'ready', 'pending_cash', 5.00, 5.00, now() - interval '30 hours')`);
    await tx.execute(sql`
      UPDATE orders SET status='ready', ready_at = now() - interval '30 hours'
      WHERE id = 'f0000000-0000-4000-8000-00000000000a'`);
  });
  const poolB = new Pool({ connectionString: process.env.DATABASE_URL });
  const dbB = drizzle(poolB);
  let disjoint = false;
  await db.transaction(async (txA) => {
    await withTenant(txA);
    const a = await txA
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.status, "ready"))
      .limit(1)
      .for("update", { skipLocked: true });
    await dbB.transaction(async (txB) => {
      await withTenant(txB);
      const b = await txB
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.status, "ready"))
        .limit(1)
        .for("update", { skipLocked: true });
      disjoint = a.length === 1 && b.length === 1 && a[0].id !== b[0].id;
    });
  });
  check(
    "4. scheduler claim: two workers get disjoint rows (no double-processing)",
    disjoint,
  );
  await poolB.end();

  // Restore: keeps the test re-runnable, and section 5 expects exactly one
  // order visible for this restaurant.
  await db.transaction(async (tx) => {
    await withTenant(tx);
    await tx.execute(sql`DELETE FROM orders WHERE id = ${TMP}`);
    await tx.execute(sql`
      UPDATE orders SET status='pending_acceptance', ready_at = NULL
      WHERE id = 'f0000000-0000-4000-8000-00000000000a'`);
  });

  // --- 5. RLS context through drizzle transaction --------------------------
  await db.execute(sql`SET ROLE sufria_dashboard`);
  const rid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const scoped = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.current_restaurant_id', ${rid}, true)`,
    );
    return tx.select({ id: orders.id }).from(orders);
  });
  check(
    "5. RLS: bind-parameter set_config inside a drizzle tx scopes the query",
    scoped.length === 1,
    `rows=${scoped.length}`,
  );
  const afterTx = await db.select({ id: orders.id }).from(orders);
  check(
    "5. RLS: context does not survive the transaction (no pool leak)",
    afterTx.length === 0,
    `rows=${afterTx.length}`,
  );
  await db.execute(sql`RESET ROLE`);

  // --- 6. 0010 order constraints ------------------------------------------
  // The order-creation transaction (task C brief §8) writes orders,
  // order_items and order_status_history together and leans on these three
  // CHECKs to fail the whole thing rather than let a wrong order reach the
  // kitchen. A constraint nobody has ever seen reject anything is a comment.
  //
  // Each case violates exactly ONE constraint: the other two are satisfied on
  // purpose, so a passing check names the constraint that actually fired
  // rather than whichever one happened to be evaluated first.
  const CID = "c0000000-0000-4000-8000-00000000000a";
  const insertOrder = (cols: string, vals: string) =>
    sql.raw(`
    INSERT INTO orders (id, restaurant_id, customer_id, payment_method,
                        status, payment_status, ${cols})
    VALUES (gen_random_uuid(), '${RID}', '${CID}', 'cash',
            'pending_acceptance', 'pending_cash', ${vals})`);

  // Asserts on the pg error's own `constraint` field, which drizzle keeps on
  // `cause`. Not a substring search of the message: that text also carries the
  // failed statement, so a query mentioning the name would pass without the
  // constraint ever firing.
  const rejects = async (label: string, constraint: string, stmt: unknown) => {
    let fired: string | undefined;
    let inserted = false;
    try {
      await db.transaction(async (tx) => {
        await withTenant(tx);
        await tx.execute(stmt as never);
      });
      inserted = true;
    } catch (e) {
      fired = (e as { cause?: { constraint?: string } }).cause?.constraint;
    }
    check(
      label,
      fired === constraint,
      inserted
        ? "INSERT SUCCEEDED — the constraint did not fire"
        : fired === constraint
          ? ""
          : `fired ${fired ?? "nothing nameable"} instead`,
    );
  };

  await rejects(
    "6. orders_total_is_subtotal_plus_fee: total that is not subtotal + fee",
    "orders_total_is_subtotal_plus_fee",
    // pickup, fee 0, address NULL — the other two constraints are satisfied.
    insertOrder(
      "fulfillment_type, subtotal, delivery_fee, total",
      "'pickup', 5.00, 0, 6.00",
    ),
  );

  await rejects(
    "6. orders_pickup_has_no_delivery_data: pickup carrying a delivery fee",
    "orders_pickup_has_no_delivery_data",
    // 5.00 + 1.50 = 6.50, so the total constraint holds and only this fires.
    insertOrder(
      "fulfillment_type, subtotal, delivery_fee, total",
      "'pickup', 5.00, 1.50, 6.50",
    ),
  );

  await rejects(
    "6. orders_pickup_has_no_delivery_data: pickup carrying an address",
    "orders_pickup_has_no_delivery_data",
    insertOrder(
      "fulfillment_type, subtotal, delivery_fee, total, delivery_address",
      "'pickup', 5.00, 0, 5.00, 'الشميساني، شارع عبد الحميد شرف، بناية 12'",
    ),
  );

  await rejects(
    "6. orders_delivery_has_address: delivery with no address at all",
    "orders_delivery_has_address",
    insertOrder(
      "fulfillment_type, subtotal, delivery_fee, total, delivery_address",
      "'delivery', 5.00, 1.50, 6.50, NULL",
    ),
  );

  await rejects(
    "6. orders_delivery_has_address: address longer than 300 characters",
    "orders_delivery_has_address",
    // 301 — the bound the engine enforces before it ever gets here (§3).
    insertOrder(
      "fulfillment_type, subtotal, delivery_fee, total, delivery_address",
      "'delivery', 5.00, 1.50, 6.50, repeat('ا', 301)",
    ),
  );

  await rejects(
    "6. orders_delivery_has_address: whitespace-only address",
    "orders_delivery_has_address",
    // btrim is why this fails: char_length alone would call it 5 characters.
    insertOrder(
      "fulfillment_type, subtotal, delivery_fee, total, delivery_address",
      "'delivery', 5.00, 1.50, 6.50, '     '",
    ),
  );

  // 🔴 The control. Without it, CHECK (false) would pass all six above and
  //    no order could ever be created — the constraints must still accept a
  //    correct delivery order, fee and address and arithmetic together.
  let accepted = false;
  await db
    .transaction(async (tx) => {
      await withTenant(tx);
      await tx.execute(
        insertOrder(
          "fulfillment_type, subtotal, delivery_fee, total, delivery_address",
          "'delivery', 5.00, 1.50, 6.50, 'الشميساني، شارع عبد الحميد شرف، بناية 12'",
        ) as never,
      );
      accepted = true;
      // Roll back: this file leaves the fixture exactly as it found it.
      tx.rollback();
    })
    .catch(() => {});
  check(
    "6. control: a correct delivery order is still accepted",
    accepted,
    accepted ? "" : "the three constraints reject everything",
  );

  console.log(
    `\n${failures === 0 ? "ALL PRIMITIVES VERIFIED" : failures + " FAILED"}`,
  );
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
