import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import {
  ORDER_TAB_STATUSES,
  type FulfillmentType,
  type OrderListItem,
  type OrderListResponse,
  type OrderStatus,
  type OrderTab,
} from "@sufria/shared";
import { TenantDbService } from "../db/tenant-db.service.js";

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
               to_char(o.created_at AT TIME ZONE 'UTC',
                       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
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
    // ISO من القاعدة نفسها: مشغّل drizzle بيرجع timestamptz نصا خاما بـexecute.
    createdAt: r.created_at,
    customer: { name: r.customer_name, phone: r.customer_phone },
  };
}
