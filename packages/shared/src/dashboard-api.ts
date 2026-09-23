/**
 * عقود API اللوحة — بريف د §3. الشاشة بتستورد نفس الأنواع اللي بيرجعها
 * `dashboard-api`، فلو تغيّر شكل رد بطرف وما تغيّر بالتاني، الـtypecheck بيوقع.
 *
 * 🔴 المال نص هون، دايما (`"13.50"`) — زي ما بترجعه القاعدة. ولا `number`:
 *    `13.5` بتعرض غير الفاتورة (بريف د §0).
 */
import type { OrderStatus } from "./domain.js";
import type { fulfillmentType } from "./schema.js";

export type FulfillmentType = (typeof fulfillmentType.enumValues)[number];

/**
 * تبويبا لوحة الطلبات — بريف د §2.5. كل حالة بتبويب واحد بالضبط، واختبار
 * `shared` بيفرض هالتقسيم على `ORDER_STATUSES` كلها: حالة جديدة بلا تبويب
 * معناها طلب ما بيشوفه الموظف أبدا.
 *
 * `active` هي نفس مجموعة الفهرس الجزئي `idx_orders_board` (0002).
 */
export const ORDER_TABS = ["active", "history"] as const;
export type OrderTab = (typeof ORDER_TABS)[number];

export const ORDER_TAB_STATUSES: Record<OrderTab, readonly OrderStatus[]> = {
  active: ["pending_acceptance", "accepted", "preparing", "ready"],
  history: ["completed", "cancelled", "expired"],
};

/** عنصر `GET /orders` — بريف د §3.1. بلا أصناف وبلا تاريخ: المسار بيُسأل كل 3-5 ثوان. */
export type OrderListItem = {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
  /** نص كما في القاعدة: `"13.50"`. */
  total: string;
  /** عدد أسطر الطلب، مش مجموع الكميات. */
  itemCount: number;
  /** ISO 8601 بتوقيت UTC. */
  createdAt: string;
  /** `name` فاضي عمليا لكل زبون حقيقي — المحرّك ما بيكتبه (بريف د §8.9). */
  customer: { name: string | null; phone: string };
};

export type OrderListResponse = {
  orders: OrderListItem[];
  /** مع `active` دايما 1. */
  page: number;
  /** مع `active` دايما false. */
  hasMore: boolean;
};
