import { Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import {
  ORDER_TAB_STATUSES,
  canStaffTransition,
  type FulfillmentType,
  type HistoryActor,
  type OrderDetail,
  type OrderListItem,
  type OrderListResponse,
  type OrderMessage,
  type OrderMessagesResponse,
  type OrderStatus,
  type OrderTab,
  type PaymentMethod,
  type PaymentStatus,
  type StaffTargetStatus,
  type UpdateOrderStatusRequest,
} from "@sufria/shared";
import { TenantDbService } from "../db/tenant-db.service.js";

/**
 * timestamptz → ISO 8601 in UTC, in SQL: the drizzle driver returns a
 * timestamptz from `execute` as raw text, not as a `Date`.
 */
const isoUtc = (column: string) =>
  sql.raw(
    `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  );

/**
 * The §3.1 item projection — one for `GET /orders` and for the reply of
 * `PATCH /orders/:id/status` (brief D §3.3 step 4: "the same query, not a
 * second projection"). Assumes `orders o` and `customers c` in the query that
 * embeds it, and yields an `OrderListRow`.
 *
 * Brief G §3 (G-4) adds three fields for the card: the lines (name and
 * quantity, in the order of `GET /orders/:id`), the time of the last status
 * change, and the cancellation reason. `status_changed_at` is the last
 * history row, or `created_at` for an order that has none (the seeded order
 * of restaurant C) — never a time the screen makes up.
 */
const orderListColumns = () => sql`
  o.id,
  o.order_number,
  o.status,
  o.fulfillment_type,
  o.total::text AS total,
  (SELECT count(*)::int FROM order_items oi WHERE oi.order_id = o.id)
    AS item_count,
  ${isoUtc("o.created_at")} AS created_at,
  c.name AS customer_name,
  c.phone_number AS customer_phone,
  COALESCE(
    (SELECT json_agg(json_build_object(
              'name', oi.item_name_snapshot,
              'quantity', oi.quantity)
            ORDER BY oi.item_name_snapshot, oi.id)
       FROM order_items oi
      WHERE oi.order_id = o.id),
    '[]'::json) AS items,
  ${isoUtc(
    `COALESCE((SELECT max(h.changed_at) FROM order_status_history h
                WHERE h.order_id = o.id), o.created_at)`,
  )} AS status_changed_at,
  o.cancellation_reason`;

/**
 * The outcome of a status change — the controller maps it to HTTP (brief D
 * §3.3 and §8.7).
 */
export type StatusChangeOutcome =
  | { kind: "changed"; order: OrderListItem }
  | { kind: "transition_not_allowed" }
  | { kind: "not_found" }
  | { kind: "status_conflict"; currentStatus: OrderStatus }
  | { kind: "payment_not_settled" };

/** Brief D §2.5: 20 per page in the `history` tab, no pages in `active`. */
export const HISTORY_PAGE_SIZE = 20;

/** Brief I §4 (I-5): an order's conversation, at most its latest 200. */
export const MESSAGES_LIMIT = 200;

/**
 * Rule 3's window for a customer message's time (brief I §4, I-5): after the
 * customer's order before this one, up to this one, and no older than 24
 * hours before it. Assumes the `o` CTE of `messages`; `time` is a column.
 */
const inWindow = (time: string) =>
  sql.raw(`(${time} > COALESCE(o.prev_at, '-infinity'::timestamptz)
            AND ${time} <= o.created_at
            AND ${time} >= o.created_at - interval '24 hours')`);

type OrderListRow = {
  id: string;
  order_number: number;
  status: OrderStatus;
  fulfillment_type: FulfillmentType;
  total: string;
  item_count: number;
  created_at: string;
  customer_name: string | null;
  customer_phone: string;
  items: { name: string; quantity: number }[];
  status_changed_at: string;
  cancellation_reason: string | null;
};

type OrderDetailRow = {
  id: string;
  order_number: number;
  status: OrderStatus;
  fulfillment_type: FulfillmentType;
  subtotal: string;
  delivery_fee: string;
  total: string;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  delivery_address: string | null;
  cancellation_reason: string | null;
  created_at: string;
  customer_name: string | null;
  customer_phone: string;
  items: {
    name: string;
    quantity: number;
    unit_price: string;
    line_total: string;
  }[];
  history: {
    from: OrderStatus | null;
    to: OrderStatus;
    actor: HistoryActor;
    at: string;
  }[];
};

@Injectable()
export class OrdersService {
  constructor(private readonly tenantDb: TenantDbService) {}

  /**
   * @param restaurantId from RestaurantContextGuard alone (brief D §8.1).
   *
   * The actual isolation is RLS, through the `runInTenant` context. The
   * explicit `restaurant_id` filter is defence in depth, not the protection:
   * without it the query returns the same rows.
   */
  async list(
    restaurantId: string,
    tab: OrderTab,
    page: number,
  ): Promise<OrderListResponse> {
    const statuses = sql.join(
      ORDER_TAB_STATUSES[tab].map((s) => sql`${s}::order_status`),
      sql`, `,
    );
    // `active`: oldest first, no pages. `history`: newest first, reading 21
    // to know `hasMore` without a COUNT. `id` breaks ties, always in the same
    // direction.
    const isHistory = tab === "history";
    const direction = sql.raw(isHistory ? "DESC" : "ASC");
    const window = isHistory
      ? sql`LIMIT ${HISTORY_PAGE_SIZE + 1} OFFSET ${(page - 1) * HISTORY_PAGE_SIZE}`
      : sql``;

    const res = await this.tenantDb.runInTenant(restaurantId, (tx) =>
      tx.execute<OrderListRow>(sql`
        SELECT ${orderListColumns()}
          FROM orders o
          JOIN customers c ON c.id = o.customer_id
         WHERE o.restaurant_id = ${restaurantId}::uuid
           AND o.status IN (${statuses})
         ORDER BY o.created_at ${direction}, o.id ${direction}
         ${window}`),
    );

    const rows = res.rows;
    const hasMore = isHistory && rows.length > HISTORY_PAGE_SIZE;
    return {
      orders: rows
        .slice(0, isHistory ? HISTORY_PAGE_SIZE : undefined)
        .map(toListItem),
      page: isHistory ? page : 1,
      hasMore,
    };
  }

  /**
   * One order with its lines and history — brief D §3.2. `null` = not found
   * under the restaurant's context, whether no order has this id or it belongs
   * to another restaurant: the two are not told apart (§2.9).
   *
   * One statement, not three: under READ COMMITTED each statement has its own
   * snapshot, so three statements could return status `accepted` with a
   * history that already holds `preparing`, had it changed between them.
   *
   * 🔴 Name and price come from the snapshot, with no join to `menu_items`:
   *    the order keeps its name and price from the moment it was placed, and
   *    the customer paid the old one. `line_total` is computed in SQL.
   */
  async detail(
    restaurantId: string,
    orderId: string,
  ): Promise<OrderDetail | null> {
    const res = await this.tenantDb.runInTenant(restaurantId, (tx) =>
      tx.execute<OrderDetailRow>(sql`
        SELECT o.id,
               o.order_number,
               o.status,
               o.fulfillment_type,
               o.subtotal::text AS subtotal,
               o.delivery_fee::text AS delivery_fee,
               o.total::text AS total,
               o.payment_method,
               o.payment_status,
               o.delivery_address,
               o.cancellation_reason,
               ${isoUtc("o.created_at")} AS created_at,
               c.name AS customer_name,
               c.phone_number AS customer_phone,
               COALESCE(
                 (SELECT json_agg(json_build_object(
                           'name', oi.item_name_snapshot,
                           'quantity', oi.quantity,
                           'unit_price', oi.unit_price_snapshot::text,
                           'line_total', (oi.quantity * oi.unit_price_snapshot)::text)
                         ORDER BY oi.item_name_snapshot, oi.id)
                    FROM order_items oi
                   WHERE oi.order_id = o.id),
                 '[]'::json) AS items,
               COALESCE(
                 (SELECT json_agg(json_build_object(
                           'from', h.from_status,
                           'to', h.to_status,
                           'actor', h.actor,
                           'at', ${isoUtc("h.changed_at")})
                         ORDER BY h.changed_at, h.id)
                    FROM order_status_history h
                   WHERE h.order_id = o.id),
                 '[]'::json) AS history
          FROM orders o
          JOIN customers c ON c.id = o.customer_id
         WHERE o.id = ${orderId}::uuid
           AND o.restaurant_id = ${restaurantId}::uuid`),
    );

    const r = res.rows[0];
    if (!r) return null;
    return {
      id: r.id,
      orderNumber: r.order_number,
      status: r.status,
      fulfillmentType: r.fulfillment_type,
      // 🔴 Money as the database returned it, as text. Never `Number()`.
      subtotal: r.subtotal,
      deliveryFee: r.delivery_fee,
      total: r.total,
      paymentMethod: r.payment_method,
      paymentStatus: r.payment_status,
      deliveryAddress: r.delivery_address,
      cancellationReason: r.cancellation_reason,
      createdAt: r.created_at,
      customer: { name: r.customer_name, phone: r.customer_phone },
      items: r.items.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unitPrice: i.unit_price,
        lineTotal: i.line_total,
      })),
      history: r.history,
    };
  }

  /**
   * `GET /orders/:id/messages` — brief I §4 (I-5): the order's conversation.
   * `null` = not found under the restaurant's context, as `detail` (§2.9).
   *
   * Which messages are the order's — the customer is the order's, and their
   * number is the very digits of `from_phone` and `to_phone` (I-0 #7):
   *   1. a bot message naming this order (`order_id`) is its;
   *   2. one naming another order is not, whatever its time;
   *   3. a customer message belongs to the first order of the same customer
   *      at the same restaurant made after it or at its moment — so from just
   *      after the order before, up to this one — and none older than 24
   *      hours before the order (`inWindow`). `received_at`: the database's
   *      clock, as `created_at` is — the «أكّد» that made the order is
   *      received in the very transaction that writes it, at its moment;
   *   4. a bot message naming no order belongs where the customer's last
   *      message before it belongs (3) — any message, an image too: the reply
   *      answered it;
   *   5. what comes after the customer's last order is no order's yet.
   * Text messages alone; the latest 200, in time order then `id`. One
   * statement, so the order and its messages are one moment's.
   *
   * RLS keeps every table to the restaurant (`runInTenant`); the explicit
   * `restaurant_id` conditions are defence in depth, and the indexes'.
   */
  async messages(
    restaurantId: string,
    orderId: string,
  ): Promise<OrderMessagesResponse | null> {
    const res = await this.tenantDb.runInTenant(restaurantId, (tx) =>
      tx.execute<{ found: boolean; messages: OrderMessage[] }>(sql`
        WITH o AS (
          SELECT o.id, o.restaurant_id, o.created_at, c.phone_number AS phone,
                 (SELECT p.created_at
                    FROM orders p
                   WHERE p.customer_id = o.customer_id
                     AND p.restaurant_id = o.restaurant_id
                     AND (p.created_at, p.id) < (o.created_at, o.id)
                   ORDER BY p.created_at DESC, p.id DESC
                   LIMIT 1) AS prev_at
            FROM orders o
            JOIN customers c ON c.id = o.customer_id
           WHERE o.id = ${orderId}::uuid
             AND o.restaurant_id = ${restaurantId}::uuid
        ),
        msgs AS (
          SELECT i.id, 'inbound' AS direction, i.body AS text, i.received_at AS at
            FROM o
            JOIN inbound_messages i
              ON i.restaurant_id = o.restaurant_id
             AND i.from_phone = o.phone
           WHERE i.body IS NOT NULL
             AND ${inWindow("i.received_at")}
          UNION ALL
          SELECT m.id, 'outbound', m.body, m.sent_at
            FROM o
            JOIN outbound_messages m
              ON m.restaurant_id = o.restaurant_id
             AND m.to_phone = o.phone
            LEFT JOIN LATERAL (
              SELECT a.received_at
                FROM inbound_messages a
               WHERE a.restaurant_id = o.restaurant_id
                 AND a.from_phone = o.phone
                 AND a.received_at <= m.sent_at
               ORDER BY a.received_at DESC, a.id DESC
               LIMIT 1) last ON true
           WHERE m.order_id = o.id
              OR (m.order_id IS NULL AND ${inWindow("last.received_at")})
        )
        SELECT EXISTS (SELECT 1 FROM o) AS found,
               COALESCE(
                 (SELECT json_agg(json_build_object(
                           'id', l.id,
                           'direction', l.direction,
                           'text', l.text,
                           'at', ${isoUtc("l.at")})
                         ORDER BY l.at, l.id)
                    FROM (SELECT * FROM msgs
                           ORDER BY at DESC, id DESC
                           LIMIT ${MESSAGES_LIMIT}) l),
                 '[]'::json) AS messages`),
    );
    const row = res.rows[0];
    if (!row?.found) return null;
    return { messages: row.messages };
  }

  /**
   * `PATCH /orders/:id/status` — brief D §3.3 with §8.2 and §8.6, in check
   * order.
   *
   * @param restaurantId    from RestaurantContextGuard alone (§8.1).
   * @param staffAccountId  from the token, for `actor_staff_id`.
   *
   * 🔴 The CAS is `AND o.status = from` **inside the UPDATE itself**, not a
   *    read before it. `from` is the status the staff member saw (§2.7); the
   *    server never reads the current one to build on. Under READ COMMITTED an
   *    UPDATE waiting on the row lock re-checks its condition against the new
   *    row version once the lock is released: of two requests at the same
   *    moment with the same `from`, the second finds zero rows.
   *
   * 🔴 One transaction: the history row comes after the UPDATE, in the same
   *    transaction, so any failure there rolls the status back with it. No
   *    order ever changes status without a history row.
   *
   * No WhatsApp message from here: `notified = false` is the only signal, and
   * the poller (FR-11) is what decides and sends.
   */
  async changeStatus(
    restaurantId: string,
    staffAccountId: string,
    orderId: string,
    change: UpdateOrderStatusRequest,
  ): Promise<StatusChangeOutcome> {
    const { from, to } = change;
    // Check 2: the transition itself is forbidden whatever the order, so it
    // comes before any query.
    if (!canStaffTransition(from, to))
      return { kind: "transition_not_allowed" };
    // Trimmed by the DTO. Empty after trimming is NULL (§2.8), and so is
    // anything that is not a cancellation (§8.6).
    const reason =
      to === "cancelled" ? change.cancellationReason || null : null;

    return this.tenantDb.runInTenant(restaurantId, async (tx) => {
      const updated = await tx.execute<OrderListRow>(sql`
        UPDATE orders o
           SET status = ${to}::order_status,
               notified = false,
               updated_at = now()${extraSets(to, reason)}
          FROM customers c
         WHERE o.id = ${orderId}::uuid
           AND o.restaurant_id = ${restaurantId}::uuid
           AND o.status = ${from}::order_status${paymentSettled(to)}
           AND c.id = o.customer_id
        RETURNING o.id`);

      if (!updated.rows[0]) {
        // Checks 3 and 4. The only reason to read the status here is to tell
        // 404 from 409, never to build the UPDATE on it (§2.7). In the same
        // transaction.
        const found = await tx.execute<{ status: OrderStatus }>(sql`
          SELECT status
            FROM orders
           WHERE id = ${orderId}::uuid
             AND restaurant_id = ${restaurantId}::uuid`);
        const current = found.rows[0];
        if (!current) return { kind: "not_found" };
        if (current.status !== from)
          return { kind: "status_conflict", currentStatus: current.status };
        // The status is `from`, so the only condition left in the WHERE is
        // the payment one. Not a race: transitions only move forward, so a
        // status once left never comes back.
        return { kind: "payment_not_settled" };
      }

      await tx.execute(sql`
        INSERT INTO order_status_history
               (order_id, restaurant_id, from_status, to_status,
                actor, actor_staff_id, reason)
        VALUES (${orderId}::uuid, ${restaurantId}::uuid, ${from}::order_status,
                ${to}::order_status, 'staff', ${staffAccountId}::uuid, ${reason})`);

      // Read back after the history row, in the same transaction, so that
      // `statusChangedAt` is this change and not the one before it — a
      // `RETURNING` on the UPDATE runs before the INSERT exists.
      const changed = await tx.execute<OrderListRow>(sql`
        SELECT ${orderListColumns()}
          FROM orders o
          JOIN customers c ON c.id = o.customer_id
         WHERE o.id = ${orderId}::uuid
           AND o.restaurant_id = ${restaurantId}::uuid`);

      return { kind: "changed", order: toListItem(changed.rows[0]!) };
    });
  }
}

/**
 * What changes besides the status, by destination — in the same UPDATE
 * (brief D §3.3 and §8.6). The database constraints are the safety net, not a
 * substitute: completed ⇒ collected or paid, `cancelled_by` set ⟺ cancelled,
 * and `ready_at` only for an order that reached `ready`.
 */
function extraSets(to: StaffTargetStatus, reason: string | null): SQL {
  switch (to) {
    case "ready":
      // The 24-hour timeout (Sprint 2) reads it. `preparing → completed`
      // leaves it NULL.
      return sql`, ready_at = now()`;
    case "completed":
      // `collected` for cash alone. An online order arrives here `paid` (the
      // WHERE condition) and stays `paid`: `collected` is a cash-only status
      // (orders_collected_is_cash).
      return sql`,
               payment_status = CASE WHEN o.payment_method = 'cash'
                                     THEN 'collected'::payment_status
                                     ELSE o.payment_status END`;
    case "cancelled":
      // §8.2: a cancellation from the dashboard is `restaurant`, the key of
      // `ORDER_STATUS_MESSAGE_AR.cancelled`.
      return sql`,
               cancelled_by = 'restaurant',
               cancellation_reason = ${reason}`;
    default:
      return sql``;
  }
}

/**
 * §8.6: a non-cash order is not completed before it is paid. Without this
 * condition the constraint `orders_completed_payment_settled` rejects it with
 * a 500 instead of an intelligible 409.
 *
 * D-4.1: the same gate on `accepted` — `canAcceptOrder` in shared (FR-13), in
 * SQL. No constraint backs this one: without the condition an unpaid online
 * order is accepted with a 200. Cancelling stays open to it: `canAcceptOrder`
 * names it the one action before payment.
 */
const PAYMENT_GATED: readonly StaffTargetStatus[] = ["accepted", "completed"];

function paymentSettled(to: StaffTargetStatus): SQL {
  return PAYMENT_GATED.includes(to)
    ? sql`
           AND (o.payment_method = 'cash' OR o.payment_status = 'paid')`
    : sql``;
}

function toListItem(r: OrderListRow): OrderListItem {
  return {
    id: r.id,
    orderNumber: r.order_number,
    status: r.status,
    fulfillmentType: r.fulfillment_type,
    // 🔴 As the database returned it. `Number()` here turns "13.50" into "13.5".
    total: r.total,
    itemCount: r.item_count,
    createdAt: r.created_at,
    customer: { name: r.customer_name, phone: r.customer_phone },
    items: r.items,
    statusChangedAt: r.status_changed_at,
    cancellationReason: r.cancellation_reason,
  };
}
