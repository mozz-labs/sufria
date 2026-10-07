/**
 * The orders board's decisions, apart from React (brief G §3, G-4): what a
 * card shows, whether it pulses, and what pressing its button leads to. The
 * components only render what this returns, so the rules are tested without
 * a browser.
 */
import {
  DASHBOARD_UI_AR,
  ORDER_STATUS_LABEL_AR,
  ORDER_TAB_STATUSES,
  amountAr,
  customerLabelAr,
  itemsSummaryAr,
  nextStaffAction,
  orderNumberLabel,
  relativeTimeAr,
  type Currency,
  type OrderListItem,
  type OrderTab,
  type StaffAction,
} from "@sufria/shared";
import type { OrdersApi } from "../api/orders-api.ts";

/** A status changed less than this long ago pulses (G-4). */
export const PULSE_MS = 60_000;

/** The active tab polls every 10 seconds (ADR-003: 10 to 15). */
export const POLL_MS = 10_000;

/** Whole minutes from an ISO time to `now`; never negative. */
export function minutesSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
}

/**
 * The pulse is the API's `statusChangedAt` and nothing else — no status
 * field made up on the screen (G-4).
 *
 * A change stamped *after* `now` pulses too: the server's clock may run ahead
 * of the browser's, and a card updated from the reply of its own button
 * carries a time newer than the screen's last tick.
 */
export function pulses(order: OrderListItem, now: number): boolean {
  return now - Date.parse(order.statusChangedAt) < PULSE_MS;
}

/**
 * No name: the screen writes the customer as the masked number, «•••• 1234»
 * (`customerLabelAr`, the same rule — a blank name is none) — a number,
 * in the numbers' font (brief I §1.5, I-9 #2).
 */
export function isMaskedCustomer(customer: { name: string | null }): boolean {
  return !customer.name?.trim();
}

/**
 * An order's details page (brief I §2.1): its id — what the API takes — and
 * `?from=history` when it was opened from «السجل», for the back link.
 */
export function orderHref(id: string, from: OrderTab): string {
  const path = `/orders/${encodeURIComponent(id)}`;
  return from === "history" ? `${path}?from=history` : path;
}

export type CardView = {
  /** The details page the card opens — on its number, stretched over it. */
  href: string;
  number: string;
  customer: string;
  /** `customer` is the masked number: set in the numbers' font. */
  customerMasked: boolean;
  /** «استلام · شاورما ×2 · بطاطا» — grey, cut with … when long. */
  details: string;
  /** Under the details, in history, for a cancellation with a reason. */
  reason: string | null;
  badge: string;
  amount: string;
  since: string;
  pulse: boolean;
  /** `null` in history and for any status without a next step. */
  action: StaffAction | null;
};

export function cardView(
  order: OrderListItem,
  tab: OrderTab,
  currency: Currency,
  now: number,
): CardView {
  const summary = itemsSummaryAr(order.items);
  const kind = DASHBOARD_UI_AR.fulfillment[order.fulfillmentType];
  return {
    href: orderHref(order.id, tab),
    number: orderNumberLabel(order.orderNumber),
    customer: customerLabelAr(order.customer),
    customerMasked: isMaskedCustomer(order.customer),
    details: summary
      ? `${kind}${DASHBOARD_UI_AR.itemSeparator}${summary}`
      : kind,
    reason:
      tab === "history" && order.status === "cancelled"
        ? order.cancellationReason
        : null,
    badge: ORDER_STATUS_LABEL_AR[order.status],
    amount: amountAr(order.total, currency),
    since: relativeTimeAr(minutesSince(order.createdAt, now)),
    pulse: pulses(order, now),
    // History has no button (G-4).
    action:
      tab === "active"
        ? nextStaffAction(order.status, order.fulfillmentType)
        : null,
  };
}

export type AdvanceOutcome =
  /** Update the card from the API's reply, at once. */
  | { kind: "changed"; order: OrderListItem }
  /** Refresh the list, and show `line` under the card. */
  | { kind: "refresh"; line: string }
  /** Show `line` under the card; the button stays. */
  | { kind: "failed"; line: string }
  /** Back to login. */
  | { kind: "unauthorized" };

/**
 * Pressing the next-step button — on a card or on the details page. `shown`
 * is the order **as the screen displayed it**: its status is the `from` of
 * the request (brief D §2.7), never a status read again before sending.
 */
export async function advance(
  api: Pick<OrdersApi, "changeStatus">,
  shown: Pick<OrderListItem, "id" | "status">,
  action: StaffAction,
): Promise<AdvanceOutcome> {
  return outcomeOf(await api.changeStatus(shown, action.to));
}

/**
 * «ألغِ الطلب» in the cancel dialog (brief I §4, I-6): `from` is the status
 * the page showed, and the reason goes only when there is one after
 * trimming — it reaches the customer word for word (brief F §1.1).
 */
export async function cancelOrder(
  api: Pick<OrdersApi, "changeStatus">,
  shown: Pick<OrderListItem, "id" | "status">,
  reason: string,
): Promise<AdvanceOutcome> {
  const trimmed = reason.trim();
  return outcomeOf(
    await api.changeStatus(
      shown,
      "cancelled",
      trimmed === "" ? undefined : trimmed,
    ),
  );
}

function outcomeOf(
  res: Awaited<ReturnType<OrdersApi["changeStatus"]>>,
): AdvanceOutcome {
  if (res.ok) return { kind: "changed", order: res.value };
  switch (res.error.kind) {
    case "unauthorized":
      return { kind: "unauthorized" };
    case "status_conflict":
      return { kind: "refresh", line: DASHBOARD_UI_AR.errors.statusConflict };
    default:
      // `payment_not_settled` and the rest: the step cannot be taken now.
      return { kind: "failed", line: DASHBOARD_UI_AR.errors.stepFailed };
  }
}

/**
 * The active list after a card changed: the order in place, or gone once its
 * status belongs to history (`completed`).
 */
export function replaceInActive(
  orders: readonly OrderListItem[],
  changed: OrderListItem,
): OrderListItem[] {
  const stays = ORDER_TAB_STATUSES.active.includes(changed.status);
  return orders.flatMap((o) =>
    o.id !== changed.id ? [o] : stays ? [changed] : [],
  );
}

/**
 * Where an order's details page goes back to (brief I §4, I-6): «السجل»
 * when it was opened from there (`?from=history`), «الطلبات» otherwise.
 */
export function backTo(from: string | string[] | undefined): {
  href: string;
  label: string;
} {
  return from === "history"
    ? { href: "/history", label: DASHBOARD_UI_AR.tabs.history }
    : { href: "/orders", label: DASHBOARD_UI_AR.tabs.active };
}
