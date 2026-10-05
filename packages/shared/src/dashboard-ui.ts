/**
 * The staff dashboard's text — brief G §3 (G-5). Every string the orders
 * screen and the login screen show is here, verbatim from the brief; nothing
 * is written inline in `dashboard-web` (brief G §0).
 *
 * The same pattern as the customer texts of `domain.ts`: one exported
 * dictionary, its exact wording held by a test, and `check:numerals` walking
 * every string in it.
 *
 * 🔴 Staff text, not customer text: the customer's WhatsApp messages stay in
 *    `ORDER_STATUS_MESSAGE_AR`, and the badges in `ORDER_STATUS_LABEL_AR`.
 */
import type { FulfillmentType, OrderListLine } from "./dashboard-api.js";
import type { StaffTargetStatus } from "./dashboard-api.js";
import {
  CURRENCY_LABEL_AR,
  CURRENCY_SLOT,
  ITEM_NAME_SLOT,
  ORDER_NUMBER_SLOT,
  PRICE_SLOT,
  QUANTITY_SLOT,
  type Currency,
  type OrderStatus,
} from "./domain.js";

/** The number in a relative time: «منذ [العدد] دقائق». */
export const COUNT_SLOT = "[العدد]";

export const DASHBOARD_UI_AR = {
  /** The wordmark, the login title and the tab title. */
  brand: "سُفريا",
  live: "مباشر",
  logout: "خروج",
  tabs: { active: "الطلبات", history: "السجل" },
  /** Under the history list, while the API says `hasMore`. */
  more: "المزيد",
  login: {
    identifier: "البريد الإلكتروني أو رقم الهاتف",
    password: "كلمة المرور",
    submit: "دخول",
    failed: "البيانات غير صحيحة.",
  },
  /** The six next-step buttons — Mohammed's decision, 27 September. */
  actions: {
    accept: "اقبل",
    startPreparing: "ابدأ التحضير",
    readyPickup: "جاهز",
    readyDelivery: "سلّمناه للسائق",
    completePickup: "استلمه الزبون",
    completeDelivery: "وصل للزبون",
  },
  errors: {
    /** Under the card, on a 409 `status_conflict`. */
    statusConflict: "تغيّرت حالة الطلب من جهاز آخر.",
    /** Under the card, on any other 409 — the button stays. */
    stepFailed: "لا يمكن تنفيذ هذه الخطوة الآن.",
    /** The strip above the list while polling fails. */
    disconnected: "انقطع الاتصال — نحاول مجددا.",
    /** An order's details that could not be read (brief I §6). */
    loadFailed: "تعذّر التحميل.",
    /** The button after «تعذّر التحميل.». */
    retry: "حاول مجددا",
  },
  /** The order details screen — brief I §6, Mohammed's approval, 5 October. */
  details: {
    notFound: "هذا الطلب غير موجود.",
    deliveryFee: "رسوم التوصيل",
    total: "المجموع",
    address: "العنوان",
    messageCustomer: "راسل الزبون",
    cancelOrder: "إلغاء الطلب",
  },
  /** The cancel dialog. The reason reaches the customer word for word. */
  cancel: {
    title: `إلغاء الطلب رقم ${ORDER_NUMBER_SLOT}؟`,
    reason: "السبب (اختياري)",
    reasonHint: "يصل السبب للزبون كما تكتبه.",
    confirm: "ألغِ الطلب",
    back: "رجوع",
  },
  /** The conversation section of the details screen. */
  conversation: {
    title: "المحادثة",
    showAll: "عرض الكل",
    hide: "إخفاء",
    empty: "لا رسائل محفوظة لهذا الطلب.",
    /** An order from before the bot's replies were kept (0013). */
    customerOnly: "تظهر هنا رسائل الزبون فقط.",
  },
  empty: {
    active: "ستظهر هنا طلبات واتساب الجديدة تلقائيا.",
    history: "لا طلبات منتهية بعد.",
  },
  fulfillment: { pickup: "استلام", delivery: "توصيل" },
  /** The card's order number, before the customer: «#102». */
  orderNumber: `#${ORDER_NUMBER_SLOT}`,
  /** The total with the restaurant's currency: «13.50 د.أ». */
  amount: `${PRICE_SLOT} ${CURRENCY_SLOT}`,
  /** A line of the card's summary; a quantity of 1 is the name alone. */
  itemLine: `${ITEM_NAME_SLOT} ×${QUANTITY_SLOT}`,
  itemSeparator: " · ",
  /**
   * A customer without a name: the last four digits of the phone, the rest
   * hidden (G-4).
   */
  maskedPhone: "•••• [آخر 4]",
  time: {
    now: "الآن",
    oneMinute: "منذ دقيقة",
    twoMinutes: "منذ دقيقتين",
    /** 3 to 10. */
    fewMinutes: `منذ ${COUNT_SLOT} دقائق`,
    /** 11 to 59. */
    manyMinutes: `منذ ${COUNT_SLOT} دقيقة`,
    oneHour: "منذ ساعة",
    twoHours: "منذ ساعتين",
    /** 3 to 10. */
    fewHours: `منذ ${COUNT_SLOT} ساعات`,
    /** 11 and up. */
    manyHours: `منذ ${COUNT_SLOT} ساعة`,
  },
} as const;

/** One pass: a value that itself holds «[..]» is never scanned again. */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\[[^\]]+\]/gu, (slot) => values[slot] ?? slot);
}

export type StaffAction = { to: StaffTargetStatus; label: string };

/**
 * The card's one button (G-4): the next step for this status and this kind of
 * order, or `null` for a status that has none on the board.
 *
 * 🔴 Every `to` here is a transition of `STAFF_TRANSITIONS` — a test walks
 *    the whole table. `preparing → completed` and cancelling are real
 *    transitions the card does not offer: cancelling belongs to the detail
 *    screen (the next task).
 */
export function nextStaffAction(
  status: OrderStatus,
  fulfillment: FulfillmentType,
): StaffAction | null {
  const a = DASHBOARD_UI_AR.actions;
  const pickup = fulfillment === "pickup";
  switch (status) {
    case "pending_acceptance":
      return { to: "accepted", label: a.accept };
    case "accepted":
      return { to: "preparing", label: a.startPreparing };
    case "preparing":
      return { to: "ready", label: pickup ? a.readyPickup : a.readyDelivery };
    case "ready":
      return {
        to: "completed",
        label: pickup ? a.completePickup : a.completeDelivery,
      };
    default:
      return null;
  }
}

/**
 * «منذ…» for a number of whole minutes (G-5). The plural forms by the
 * brief's table; a negative count (a clock ahead of the server's) reads as
 * «الآن».
 */
export function relativeTimeAr(minutes: number): string {
  const t = DASHBOARD_UI_AR.time;
  const m = Math.max(0, Math.floor(minutes));
  const n = (template: string, count: number) =>
    fill(template, { [COUNT_SLOT]: String(count) });
  if (m === 0) return t.now;
  if (m === 1) return t.oneMinute;
  if (m === 2) return t.twoMinutes;
  if (m <= 10) return n(t.fewMinutes, m);
  if (m <= 59) return n(t.manyMinutes, m);
  if (m <= 119) return t.oneHour;
  if (m <= 179) return t.twoHours;
  const h = Math.floor(m / 60);
  if (h <= 10) return n(t.fewHours, h);
  return n(t.manyHours, h);
}

/** «شاورما ×2 · بطاطا» — the card's grey line, by the API's order. */
export function itemsSummaryAr(items: readonly OrderListLine[]): string {
  return items
    .map((i) =>
      i.quantity === 1
        ? i.name
        : fill(DASHBOARD_UI_AR.itemLine, {
            [ITEM_NAME_SLOT]: i.name,
            [QUANTITY_SLOT]: String(i.quantity),
          }),
    )
    .join(DASHBOARD_UI_AR.itemSeparator);
}

/**
 * The customer on the card: the name, or the phone with only its last four
 * digits showing.
 */
export function customerLabelAr(customer: {
  name: string | null;
  phone: string;
}): string {
  const name = customer.name?.trim();
  if (name) return name;
  const digits = customer.phone.replace(/[^0-9]/g, "");
  return fill(DASHBOARD_UI_AR.maskedPhone, { "[آخر 4]": digits.slice(-4) });
}

/** «#102». */
export function orderNumberLabel(orderNumber: number): string {
  return fill(DASHBOARD_UI_AR.orderNumber, {
    [ORDER_NUMBER_SLOT]: String(orderNumber),
  });
}

/** «إلغاء الطلب رقم 102؟» — the dialog's title (brief I §6). */
export function cancelTitleAr(orderNumber: number): string {
  return fill(DASHBOARD_UI_AR.cancel.title, {
    [ORDER_NUMBER_SLOT]: String(orderNumber),
  });
}

/**
 * «14:05» — an ISO time as `HH:MM`, 24-hour, Western digits, in the device's
 * time zone (brief I §4, I-7).
 *
 * 🔴 Built from the numbers, not `toLocaleTimeString`: the browser's
 *    language decides that one's digits, and `ar` writes «١٤:٠٥».
 */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

/**
 * The customer's WhatsApp chat — `https://wa.me/<number>`, its `+` and spaces
 * removed (brief I §4, I-6). The full number lives in this link alone; the
 * screen shows «•••• 1234».
 */
export function waLink(phone: string): string {
  return `https://wa.me/${phone.replace(/[+\s]/g, "")}`;
}

/**
 * «13.50 د.أ» — the amount **as the API returned it**, text, never through
 * `Number` (brief G §0).
 */
export function amountAr(amount: string, currency: Currency): string {
  return fill(DASHBOARD_UI_AR.amount, {
    [PRICE_SLOT]: amount,
    [CURRENCY_SLOT]: CURRENCY_LABEL_AR[currency],
  });
}
