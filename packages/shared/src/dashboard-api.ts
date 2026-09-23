/**
 * The dashboard API contracts — brief D §3, as built in §9. The screen imports
 * the very types `dashboard-api` returns, so a response shape that changes on
 * one side and not the other fails typecheck.
 *
 * 🔴 Money is text here, always (`"13.50"`), as the database returns it.
 *    Never `number`: `13.5` shows something other than the bill (brief D §0).
 */
import type { Currency, OrderStatus, PaymentStatus } from "./domain.js";
import type { actorKind, fulfillmentType, paymentMethod } from "./schema.js";

export type FulfillmentType = (typeof fulfillmentType.enumValues)[number];

/**
 * The two tabs of the orders board — brief D §2.5. Every status is in exactly
 * one tab, and a `shared` test holds that split over all of `ORDER_STATUSES`:
 * a new status with no tab is an order staff never see.
 *
 * `active` is the same set as the partial index `idx_orders_board` (0002).
 */
export const ORDER_TABS = ["active", "history"] as const;
export type OrderTab = (typeof ORDER_TABS)[number];

export const ORDER_TAB_STATUSES: Record<OrderTab, readonly OrderStatus[]> = {
  active: ["pending_acceptance", "accepted", "preparing", "ready"],
  history: ["completed", "cancelled", "expired"],
};

/**
 * An item of `GET /orders` — brief D §3.1. No lines and no history: the route
 * is polled every 3-5 seconds.
 */
export type OrderListItem = {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
  /** Text as the database holds it: `"13.50"`. */
  total: string;
  /** The number of order lines, not the sum of quantities. */
  itemCount: number;
  /** ISO 8601 in UTC. */
  createdAt: string;
  /**
   * `name` is empty in practice for every real customer — the engine never
   * writes it (brief D §8.9).
   */
  customer: { name: string | null; phone: string };
};

export type OrderListResponse = {
  orders: OrderListItem[];
  /** Always 1 with `active`. */
  page: number;
  /** Always false with `active`. */
  hasMore: boolean;
};

export type PaymentMethod = (typeof paymentMethod.enumValues)[number];
export type HistoryActor = (typeof actorKind.enumValues)[number];

/**
 * A line of `GET /orders/:id`. Name and price are the snapshot taken when the
 * order was placed, not `menu_items`: the customer paid the old price
 * (brief D §3.2).
 */
export type OrderDetailItem = {
  name: string;
  quantity: number;
  unitPrice: string;
  /** `quantity * unitPrice`, computed in SQL. */
  lineTotal: string;
};

export type OrderHistoryEntry = {
  /** `null` on the creation row alone. */
  from: OrderStatus | null;
  to: OrderStatus;
  actor: HistoryActor;
  /** ISO 8601 in UTC. */
  at: string;
};

/** `GET /orders/:id` — brief D §3.2. */
export type OrderDetail = {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
  subtotal: string;
  /** `"0.00"` for pickup. */
  deliveryFee: string;
  total: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  /** `null` for pickup. */
  deliveryAddress: string | null;
  cancellationReason: string | null;
  createdAt: string;
  customer: { name: string | null; phone: string };
  items: OrderDetailItem[];
  /** In chronological order. */
  history: OrderHistoryEntry[];
};

/**
 * The statuses the dashboard can move an order to — brief D §2.6.
 * `pending_acceptance` and `expired` never are: the first is the creation
 * status, the second is set by the system (Sprint 2). Either as a destination
 * in the request → 400 (§3.3 check 1).
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
 * Staff transitions from the dashboard — the table of brief D §2.6 verbatim,
 * and a subset of `ALLOWED_TRANSITIONS` (a `shared` test holds it to that).
 *
 * 🔴 Not `canTransition`: it includes `ready → expired`, which is the
 *    system's alone. The screen disables its buttons by this table, and the
 *    API rejects any transition outside it with a 409
 *    `transition_not_allowed`.
 */
export const STAFF_TRANSITIONS: Record<
  OrderStatus,
  readonly StaffTargetStatus[]
> = {
  pending_acceptance: ["accepted", "cancelled"],
  accepted: ["preparing", "cancelled"],
  // `ready` is optional: `preparing → completed` directly is allowed.
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

/** Body of `PATCH /orders/:id/status` — brief D §3.3. */
export type UpdateOrderStatusRequest = {
  /**
   * The status the staff member **saw** on their screen, not the current one
   * in the database (§2.7): if it changed meanwhile, the reply is a 409 and
   * they see the real one — instead of an order in the kitchen being
   * cancelled on the strength of a stale screen.
   */
  from: OrderStatus;
  to: StaffTargetStatus;
  /**
   * With `to: "cancelled"` alone. Trimmed at both ends; empty after trimming
   * is NULL.
   */
  cancellationReason?: string;
};

/** The 200 of `PATCH /orders/:id/status`: the order as a `GET /orders` item. */
export type UpdateOrderStatusResponse = OrderListItem;

export type OrderStatusConflictCode =
  "transition_not_allowed" | "status_conflict" | "payment_not_settled";

/**
 * The 409 body of `PATCH /orders/:id/status` — brief D §8.7: Nest's default
 * shape plus `code`, and `currentStatus` with `status_conflict` alone.
 *
 * The screen reads `code`, not `message`: `message` is English, for the
 * developer, and the Arabic text for staff belongs in the screen's brief.
 */
export type OrderStatusConflictBody =
  | {
      statusCode: 409;
      error: "Conflict";
      code: "status_conflict";
      message: string;
      /** The real status in the database, for the screen to show. */
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
