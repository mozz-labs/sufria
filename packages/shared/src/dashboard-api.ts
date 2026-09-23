/**
 * عقود API اللوحة — بريف د §3. الشاشة بتستورد نفس الأنواع اللي بيرجعها
 * `dashboard-api`، فلو تغيّر شكل رد بطرف وما تغيّر بالتاني، الـtypecheck بيوقع.
 *
 * 🔴 المال نص هون، دايما (`"13.50"`) — زي ما بترجعه القاعدة. ولا `number`:
 *    `13.5` بتعرض غير الفاتورة (بريف د §0).
 */
import type { Currency, OrderStatus, PaymentStatus } from "./domain.js";
import type { actorKind, fulfillmentType, paymentMethod } from "./schema.js";

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

export type PaymentMethod = (typeof paymentMethod.enumValues)[number];
export type HistoryActor = (typeof actorKind.enumValues)[number];

/**
 * سطر من `GET /orders/:id`. الاسم والسعر من الـsnapshot لحظة الطلب، لا من
 * `menu_items`: الزبون دفع القديم (بريف د §3.2).
 */
export type OrderDetailItem = {
  name: string;
  quantity: number;
  unitPrice: string;
  /** `quantity * unitPrice`، محسوب بـSQL. */
  lineTotal: string;
};

export type OrderHistoryEntry = {
  /** `null` بسطر الإنشاء وحده. */
  from: OrderStatus | null;
  to: OrderStatus;
  actor: HistoryActor;
  /** ISO 8601 بتوقيت UTC. */
  at: string;
};

/** `GET /orders/:id` — بريف د §3.2. */
export type OrderDetail = {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
  subtotal: string;
  /** `"0.00"` للاستلام. */
  deliveryFee: string;
  total: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  /** `null` للاستلام. */
  deliveryAddress: string | null;
  cancellationReason: string | null;
  createdAt: string;
  customer: { name: string | null; phone: string };
  items: OrderDetailItem[];
  /** بالترتيب الزمني. */
  history: OrderHistoryEntry[];
};

/**
 * الحالات اللي بتكون وجهة من اللوحة — بريف د §2.6. `pending_acceptance`
 * و`expired` مش منها أبدا: الأولى حالة الإنشاء، والتانية بيحطّها النظام
 * (Sprint 2). وجهة منهم بالطلب ← 400 (§3.3 فحص 1).
 */
export const STAFF_TARGET_STATUSES = [
  "accepted",
  "preparing",
  "ready",
  "completed",
  "cancelled",
] as const;
export type StaffTargetStatus = (typeof STAFF_TARGET_STATUSES)[number];

/**
 * انتقالات الموظف من اللوحة — جدول بريف د §2.6 حرفيا، وجزء من
 * `ALLOWED_TRANSITIONS` (اختبار `shared` بيفرضها).
 *
 * 🔴 مش `canTransition`: فيها `ready ← expired`، وهاي للنظام وحده. الشاشة
 *    بتعطّل أزرارها حسب هالجدول، والـAPI بيرفض أي انتقال برّاه بـ409
 *    `transition_not_allowed`.
 */
export const STAFF_TRANSITIONS: Record<
  OrderStatus,
  readonly StaffTargetStatus[]
> = {
  pending_acceptance: ["accepted", "cancelled"],
  accepted: ["preparing", "cancelled"],
  // `ready` اختيارية: `preparing ← completed` مباشرة مسموح.
  preparing: ["ready", "completed", "cancelled"],
  ready: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  expired: [],
};

export function canStaffTransition(
  from: OrderStatus,
  to: StaffTargetStatus,
): boolean {
  return STAFF_TRANSITIONS[from].includes(to);
}

/** جسم `PATCH /orders/:id/status` — بريف د §3.3. */
export type UpdateOrderStatusRequest = {
  /**
   * الحالة اللي **شافها الموظف** على شاشته، مش الحالية بالقاعدة (§2.7):
   * لو تغيّرت بالأثناء، الرد 409 والموظف بيشوف الحقيقية — بدل ما ينلغى طلب
   * بالمطبخ بناءً على شاشة قديمة.
   */
  from: OrderStatus;
  to: StaffTargetStatus;
  /** مع `to: "cancelled"` وحدها. بيتقصّ من الطرفين، والفاضي بعد القصّ NULL. */
  cancellationReason?: string;
};

/** الرد 200 من `PATCH /orders/:id/status`: الطلب بشكل عنصر `GET /orders`. */
export type UpdateOrderStatusResponse = OrderListItem;

export type OrderStatusConflictCode =
  "transition_not_allowed" | "status_conflict" | "payment_not_settled";

/**
 * جسم الـ409 من `PATCH /orders/:id/status` — بريف د §8.7: شكل Nest
 * الافتراضي ومعه `code`. و`currentStatus` مع `status_conflict` وحدها.
 *
 * الشاشة بتقرأ `code` لا `message`: `message` إنجليزي للمطوّر، والنص العربي
 * للموظف مكانه بريف الشاشة.
 */
export type OrderStatusConflictBody =
  | {
      statusCode: 409;
      error: "Conflict";
      code: "status_conflict";
      message: string;
      /** الحالة الحقيقية بالقاعدة، عشان الشاشة تعرضها. */
      currentStatus: OrderStatus;
    }
  | {
      statusCode: 409;
      error: "Conflict";
      code: Exclude<OrderStatusConflictCode, "status_conflict">;
      message: string;
    };

/**
 * An item of `GET /menu-items` — brief D §3.4 with §8.3. Unavailable items are
 * included, so staff can turn them back on; items of an inactive category are
 * not, because the engine treats them as unavailable whatever `isAvailable`
 * says.
 */
export type MenuItemListItem = {
  id: string;
  name: string;
  /** Text as the database holds it: `"2.50"`. */
  price: string;
  /** `menu_items.is_available` — the very column the engine reads at «أكّد». */
  isAvailable: boolean;
};

/** `GET /menu-items`, in the order the customer sees the menu. */
export type MenuItemListResponse = {
  items: MenuItemListItem[];
};

/** Body of `PATCH /menu-items/:id` — at least one of the two. */
export type UpdateMenuItemRequest = {
  isAvailable?: boolean;
  /** Western digits only, greater than zero, at most two decimals: `"3.00"`. */
  price?: string;
};

/** The 200 of `PATCH /menu-items/:id`: the item after the change. */
export type UpdateMenuItemResponse = MenuItemListItem;

/**
 * The day keys the settings screen writes into `restaurants.business_hours` —
 * the short form of `docs/10-عقد-ساعات-الدوام.md`, which is also the form the
 * engine's own tests use.
 *
 * 🔴 The writer is strict and the reader lenient (brief D §8.8). The engine
 *    also reads `"sunday"` and `"9:00"`; the dashboard never writes them.
 */
export const OPENING_DAYS = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
] as const;
export type OpeningDay = (typeof OPENING_DAYS)[number];

/** `"HH:MM"`, 24-hour, two digits each, Western digits: `"09:00"`, never `"9:00"`. */
export type OpeningWindow = { open: string; close: string };

/**
 * `restaurants.business_hours` as the dashboard writes it: all seven days,
 * always, a closed day as `[]` (D-6.1). The engine reads a week in which it
 * recognises no day — `{}`, `{ days: {} }` — as always open, so the dashboard
 * never writes one. A window whose `close` is before its `open` runs past
 * midnight.
 */
export type OpeningHours = {
  days: Record<OpeningDay, OpeningWindow[]>;
};

/** `GET /restaurant/settings` — brief D §3.5. The restaurant is the guard's. */
export type RestaurantSettings = {
  /** Read-only: set when the restaurant is onboarded (§2.2). */
  currency: Currency;
  /** Read-only from the dashboard (§2.10). */
  offersDelivery: boolean;
  /** Text as the database holds it: `"1.50"`, `"0.00"`. */
  deliveryFee: string;
  /** `null` = the handoff message sends nothing, by decision (0009). */
  contactPhone: string | null;
  /**
   * Stored as is, never rewritten on the way out. `{}` is the column's
   * default and means always open. A row written by hand before the settings
   * screen may carry a form only the engine's lenient reader accepts.
   */
  openingHours: OpeningHours | Record<string, never>;
};

/**
 * Body of `PATCH /restaurant/settings` — at least one field. `currency`,
 * `offersDelivery` and `timezone` are not writable from here: sending any of
 * them is a 400.
 */
export type UpdateRestaurantSettingsRequest = {
  /** Western digits, zero allowed, at most two decimals: `"1.50"`. */
  deliveryFee?: string;
  /**
   * 7 to 15 Western digits, optional leading `+`: `"0790000099"`,
   * `"+962790000099"`. `null` clears it — the handoff then sends nothing.
   */
  contactPhone?: string | null;
  /** The whole week, replaced at once. */
  openingHours?: OpeningHours;
};

/** The 200 of `PATCH /restaurant/settings`: the settings after the change. */
export type UpdateRestaurantSettingsResponse = RestaurantSettings;
