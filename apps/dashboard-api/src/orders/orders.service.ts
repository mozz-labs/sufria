import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import {
  ORDER_TAB_STATUSES,
  type FulfillmentType,
  type HistoryActor,
  type OrderDetail,
  type OrderListItem,
  type OrderListResponse,
  type OrderStatus,
  type OrderTab,
  type PaymentMethod,
  type PaymentStatus,
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
        SELECT o.id,
               o.order_number,
               o.status,
               o.fulfillment_type,
               o.total::text AS total,
               (SELECT count(*)::int FROM order_items oi WHERE oi.order_id = o.id)
                 AS item_count,
               ${isoUtc("o.created_at")} AS created_at,
               c.name AS customer_name,
               c.phone_number AS customer_phone
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
