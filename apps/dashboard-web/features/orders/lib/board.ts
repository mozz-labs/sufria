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

export type CardView = {
  number: string;
  customer: string;
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
    number: orderNumberLabel(order.orderNumber),
    customer: customerLabelAr(order.customer),
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
 * Pressing the card's button. `shown` is the order **as the card displayed
 * it**: its status is the `from` of the request (brief D §2.7), never a
 * status read again before sending.
 */
export async function advance(
  api: Pick<OrdersApi, "changeStatus">,
  shown: OrderListItem,
  action: StaffAction,
): Promise<AdvanceOutcome> {
  const res = await api.changeStatus(shown, action.to);
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
