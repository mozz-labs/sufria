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
  type OrderStatus,
  type OrderTab,
  type PaymentMethod,
  type PaymentStatus,
  type StaffTargetStatus,
  type UpdateOrderStatusRequest,
} from "@sufria/shared";
import { TenantDbService } from "../db/tenant-db.service.js";

/**
 * timestamptz ← ISO 8601 بتوقيت UTC، بـSQL: مشغّل drizzle بيرجع timestamptz
 * نصا خاما بـexecute، مش `Date`.
 */
const isoUtc = (column: string) =>
  sql.raw(
    `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  );

/**
 * إسقاط عنصر §3.1 — واحد لـ`GET /orders` ولرد `PATCH /orders/:id/status`
 * (بريف د §3.3 خطوة 4: «بنفس الاستعلام لا بإسقاط ثانٍ»). بيفترض `orders o`
 * و`customers c` بالاستعلام اللي بيحطّه، وبيطلع `OrderListRow`.
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
  c.phone_number AS customer_phone`;

/** نتيجة تغيير الحالة — الكنترولر بيحوّلها لرد HTTP (بريف د §3.3 و§8.7). */
export type StatusChangeOutcome =
  | { kind: "changed"; order: OrderListItem }
  | { kind: "transition_not_allowed" }
  | { kind: "not_found" }
  | { kind: "status_conflict"; currentStatus: OrderStatus }
  | { kind: "payment_not_settled" };

/** بريف د §2.5: 20 بالصفحة بتبويب `history`، وبلا صفحات بـ`active`. */
export const HISTORY_PAGE_SIZE = 20;

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
   * @param restaurantId من RestaurantContextGuard وحده (بريف د §8.1).
   *
   * العزل الفعلي هو RLS عبر سياق `runInTenant`. شرط `restaurant_id` الصريح
   * دفاع إضافي، مش هو الحماية: بدونه الاستعلام بيرجع نفس الصفوف.
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
    // `active`: الأقدم أولا وبلا صفحات. `history`: الأحدث أولا، 21 لنعرف
    // `hasMore` بلا COUNT. و`id` كاسر تعادل بنفس الاتجاه دايما.
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
   * طلب واحد بأسطره وتاريخه — بريف د §3.2. `null` = غير موجود تحت سياق
   * المطعم، سواء ما في طلب بهالمعرّف أو هو لمطعم تاني: ما منفرّق بينهم (§2.9).
   *
   * جملة وحدة لا ثلاث: كل جملة بـREAD COMMITTED إلها snapshot، فتلات جمل
   * ممكن تعطي حالة `accepted` مع تاريخ فيه `preparing` لو تغيّرت بينهم.
   *
   * 🔴 الاسم والسعر من الـsnapshot، ولا ربط مع `menu_items`: الطلب بيبقى
   *    باسمه وسعره لحظة الطلب، والزبون دفع القديم. و`line_total` بـSQL.
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
      // 🔴 المال كما رجع من القاعدة، نصا. ولا `Number()`.
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
   * `PATCH /orders/:id/status` — بريف د §3.3 مع §8.2 و§8.6، بترتيب الفحص.
   *
   * @param restaurantId    من RestaurantContextGuard وحده (§8.1).
   * @param staffAccountId  من التوكن، لـ`actor_staff_id`.
   *
   * 🔴 الـCAS هو `AND o.status = from` **جوّا نفس الـUPDATE**، مش قراءة قبله.
   *    `from` هي الحالة اللي شافها الموظف (§2.7)، والخادم ما بيقرأ الحالية
   *    ليبني عليها. وبـREAD COMMITTED، UPDATE واقف على قفل الصف بيعيد فحص
   *    شرطه على النسخة الجديدة لما يتحرّر القفل: فمن طلبين بنفس اللحظة وبنفس
   *    `from`، التاني بيلاقي صفر صفوف.
   *
   * 🔴 ترانزاكشن وحدة: سطر التاريخ بعد الـUPDATE وبنفس الترانزاكشن، فأي فشل
   *    فيه بيرجّع الحالة معه. ولا طلب تغيّرت حالته بلا سطر تاريخ.
   *
   * ولا رسالة واتساب من هون: `notified = false` هي الإشارة الوحيدة، والمُراقِب
   * (FR-11) هو اللي بيقرّر ويبعت.
   */
  async changeStatus(
    restaurantId: string,
    staffAccountId: string,
    orderId: string,
    change: UpdateOrderStatusRequest,
  ): Promise<StatusChangeOutcome> {
    const { from, to } = change;
    // فحص 2: الانتقال نفسه ممنوع أيّا كان الطلب، فقبل أي استعلام.
    if (!canStaffTransition(from, to))
      return { kind: "transition_not_allowed" };
    // مقصوص بالـDTO. الفاضي بعد القصّ NULL (§2.8)، وبغير الإلغاء NULL (§8.6).
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
        RETURNING ${orderListColumns()}`);
      const row = updated.rows[0];

      if (!row) {
        // فحص 3 و4. السبب الوحيد لقراءة الحالة هون هو التفريق بين 404 و409،
        // مش بناء الـUPDATE عليها (§2.7). وبنفس الترانزاكشن.
        const found = await tx.execute<{ status: OrderStatus }>(sql`
          SELECT status
            FROM orders
           WHERE id = ${orderId}::uuid
             AND restaurant_id = ${restaurantId}::uuid`);
        const current = found.rows[0];
        if (!current) return { kind: "not_found" };
        if (current.status !== from)
          return { kind: "status_conflict", currentStatus: current.status };
        // الحالة هي `from`، فالشرط الوحيد الباقي بالـWHERE هو شرط الدفع. ومش
        // سباق: الانتقالات لقدّام بس، فحالة انتركت ما بترجع.
        return { kind: "payment_not_settled" };
      }

      await tx.execute(sql`
        INSERT INTO order_status_history
               (order_id, restaurant_id, from_status, to_status,
                actor, actor_staff_id, reason)
        VALUES (${orderId}::uuid, ${restaurantId}::uuid, ${from}::order_status,
                ${to}::order_status, 'staff', ${staffAccountId}::uuid, ${reason})`);

      return { kind: "changed", order: toListItem(row) };
    });
  }
}

/**
 * اللي بيتغيّر فوق الحالة، حسب الوجهة — بنفس الـUPDATE (بريف د §3.3 و§8.6).
 * قيود القاعدة شبكة الأمان ومش بديل: مكتمل ⇒ محصَّل أو مدفوع، و`cancelled_by`
 * موجود ⟺ ملغى، و`ready_at` بس لطلب وصل `ready`.
 */
function extraSets(to: StaffTargetStatus, reason: string | null): SQL {
  switch (to) {
    case "ready":
      // مهلة الـ24 ساعة (Sprint 2) بتقرأه. `preparing ← completed` بيتركه NULL.
      return sql`, ready_at = now()`;
    case "completed":
      // `collected` للنقدي وحده. الأونلاين بيوصل هون `paid` (شرط الـWHERE)
      // وبيضل `paid`: `collected` حالة نقدية بس (orders_collected_is_cash).
      return sql`,
               payment_status = CASE WHEN o.payment_method = 'cash'
                                     THEN 'collected'::payment_status
                                     ELSE o.payment_status END`;
    case "cancelled":
      // §8.2: الإلغاء من اللوحة `restaurant`، مفتاح `ORDER_STATUS_MESSAGE_AR.cancelled`.
      return sql`,
               cancelled_by = 'restaurant',
               cancellation_reason = ${reason}`;
    default:
      return sql``;
  }
}

/**
 * §8.6: طلب غير نقدي ما بيكتمل قبل ما ينقبض. بلا هالشرط، القيد
 * `orders_completed_payment_settled` بيرفضه بـ500 بدل 409 مفهومة.
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
    // 🔴 كما رجع من القاعدة. `Number()` هون بتقلب "13.50" لـ"13.5".
    total: r.total,
    itemCount: r.item_count,
    createdAt: r.created_at,
    customer: { name: r.customer_name, phone: r.customer_phone },
  };
}
