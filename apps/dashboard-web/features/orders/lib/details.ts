/**
 * The order details page's decisions, apart from React (brief I §4, I-6):
 * what the page shows of an order and of its conversation. The components
 * only render what these return, so the rules are tested without a browser.
 */
import {
  DASHBOARD_UI_AR,
  MAX_CANCELLATION_REASON_LENGTH,
  ORDER_STATUS_LABEL_AR,
  PAYMENT_STATUS_LABEL_AR,
  STAFF_TRANSITIONS,
  amountAr,
  clockTime,
  customerLabelAr,
  itemsSummaryAr,
  nextStaffAction,
  orderNumberLabel,
  relativeTimeAr,
  waLink,
  type Currency,
  type OrderDetail,
  type OrderMessage,
  type OrderStatus,
  type StaffAction,
} from "@sufria/shared";
import { isMaskedCustomer, minutesSince } from "./board.ts";

/** «الطلب» polls every 10 seconds, its conversation every 30 (I-6). */
export const DETAIL_POLL_MS = 10_000;
export const MESSAGES_POLL_MS = 30_000;

export type DetailView = {
  /** The order number, as the card writes it — the page's <h1>. */
  number: string;
  status: OrderStatus;
  badge: string;
  /** «استلام» or «توصيل». */
  kind: string;
  /** «•••• 1234» — the full number is in `chat` alone. */
  customer: string;
  /** `customer` is the masked number: set in the numbers' font. */
  customerMasked: boolean;
  since: string;
  /** One per item: «شاورما ×2» and its line total with the currency. */
  lines: { label: string; amount: string }[];
  /** «رسوم التوصيل» — for a delivery alone. */
  deliveryFee: string | null;
  total: string;
  /** «محصَّل» for `collected`; nothing for `pending_cash`, by design. */
  payment: string | null;
  /** The customer's own words: shown `dir="auto"`. A delivery alone. */
  address: string | null;
  /** Staff's words, sent to the customer as written. Cancelled alone. */
  reason: string | null;
  /** Each status the order went through, with its `HH:MM` on this device. */
  history: { key: string; status: OrderStatus; badge: string; time: string }[];
  /** The next step — the card's own; `null` once the order is done. */
  action: StaffAction | null;
  /** «إلغاء الطلب» — wherever the staff transitions allow `cancelled`. */
  canCancel: boolean;
  /** «راسل الزبون»: `https://wa.me/<digits>`. */
  chat: string;
};

export function detailView(
  order: OrderDetail,
  currency: Currency,
  now: number,
): DetailView {
  const delivery = order.fulfillmentType === "delivery";
  return {
    number: orderNumberLabel(order.orderNumber),
    status: order.status,
    badge: ORDER_STATUS_LABEL_AR[order.status],
    kind: DASHBOARD_UI_AR.fulfillment[order.fulfillmentType],
    customer: customerLabelAr(order.customer),
    customerMasked: isMaskedCustomer(order.customer),
    since: relativeTimeAr(minutesSince(order.createdAt, now)),
    // The card's rule for each line: a quantity of 1 is the name alone.
    lines: order.items.map((item) => ({
      label: itemsSummaryAr([item]),
      amount: amountAr(item.lineTotal, currency),
    })),
    deliveryFee: delivery ? amountAr(order.deliveryFee, currency) : null,
    total: amountAr(order.total, currency),
    payment: PAYMENT_STATUS_LABEL_AR[order.paymentStatus] ?? null,
    address: delivery ? order.deliveryAddress : null,
    reason: order.status === "cancelled" ? order.cancellationReason : null,
    history: order.history.map((h, i) => ({
      key: `${i}-${h.to}`,
      status: h.to,
      badge: ORDER_STATUS_LABEL_AR[h.to],
      time: clockTime(h.at),
    })),
    action: nextStaffAction(order.status, order.fulfillmentType),
    canCancel: STAFF_TRANSITIONS[order.status].includes("cancelled"),
    chat: waLink(order.customer.phone),
  };
}

/**
 * The cancel dialog's counter, «12 / 300» (brief I §6) — drawn left to right
 * as one isolated group (`dir="ltr"` on its `.num`): inside the page's right
 * to left it read «300 / 12» (I-9 #3).
 */
export function reasonCounter(length: number): string {
  return `${length} / ${MAX_CANCELLATION_REASON_LENGTH}`;
}

/** A bot message longer than this many lines opens on its first two (I-6). */
export const LONG_MESSAGE_LINES = 6;
export const PREVIEW_LINES = 2;

export type ConversationView = {
  /**
   * The line above the messages: none kept at all, or the customer's alone —
   * an order from before the bot's replies were kept (0013).
   */
  notice: string | null;
  messages: {
    id: string;
    /** The customer's at the start of the line, the bot's at its end. */
    from: "customer" | "bot";
    /** As it arrived — Arabic-Indic digits included: it is what they wrote. */
    text: string;
    /** The first lines of a long bot message; `null` for one shown whole. */
    preview: string | null;
    time: string;
  }[];
};

export function conversationView(
  messages: readonly OrderMessage[],
): ConversationView {
  const notice =
    messages.length === 0
      ? DASHBOARD_UI_AR.conversation.empty
      : messages.every((m) => m.direction === "inbound")
        ? DASHBOARD_UI_AR.conversation.customerOnly
        : null;
  return {
    notice,
    messages: messages.map((m) => {
      const lines = m.text.split("\n");
      const long =
        m.direction === "outbound" && lines.length > LONG_MESSAGE_LINES;
      return {
        id: m.id,
        from: m.direction === "inbound" ? "customer" : "bot",
        text: m.text,
        preview: long ? lines.slice(0, PREVIEW_LINES).join("\n") : null,
        time: clockTime(m.at),
      };
    }),
  };
}
