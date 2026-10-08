/**
 * The dashboard's dictionary and pure functions — brief G §3 (G-5) and §4
 * tests 1 and 2. The wording is held verbatim, as the customer texts are.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  DASHBOARD_UI_AR,
  ORDER_STATUSES,
  STAFF_TRANSITIONS,
  amountAr,
  cancelTitleAr,
  clockTime,
  customerLabelAr,
  dateTime,
  historyTime,
  itemsSummaryAr,
  nextStaffAction,
  orderNumberLabel,
  relativeTimeAr,
  sinceAr,
  waLink,
  type FulfillmentType,
  type OrderStatus,
} from "@sufria/shared";

test("DASHBOARD_UI_AR is the brief's text, verbatim", () => {
  assert.deepEqual(DASHBOARD_UI_AR, {
    brand: "سُفريا",
    live: "مباشر",
    logout: "خروج",
    tabs: { active: "الطلبات", history: "السجل" },
    more: "المزيد",
    login: {
      identifier: "البريد الإلكتروني أو رقم الهاتف",
      password: "كلمة المرور",
      submit: "دخول",
      failed: "البيانات غير صحيحة.",
    },
    actions: {
      accept: "اقبل",
      startPreparing: "ابدأ التحضير",
      readyPickup: "جاهز",
      readyDelivery: "سلّمناه للسائق",
      completePickup: "استلمه الزبون",
      completeDelivery: "وصل للزبون",
    },
    errors: {
      statusConflict: "تغيّرت حالة الطلب من جهاز آخر.",
      stepFailed: "لا يمكن تنفيذ هذه الخطوة الآن.",
      disconnected: "انقطع الاتصال — نحاول مجددا.",
      loadFailed: "تعذّر التحميل.",
      retry: "حاول مجددا",
    },
    // Brief I §6, verbatim (Mohammed, 5 October).
    details: {
      notFound: "هذا الطلب غير موجود.",
      deliveryFee: "رسوم التوصيل",
      total: "المجموع",
      address: "العنوان",
      // Brief I-9 #4 (Mohammed, 6 October).
      cancellationReason: "سبب الإلغاء",
      messageCustomer: "راسل الزبون",
      cancelOrder: "إلغاء الطلب",
    },
    cancel: {
      title: "إلغاء الطلب رقم [رقم الطلب]؟",
      reason: "السبب (اختياري)",
      reasonHint: "يصل السبب للزبون كما تكتبه.",
      confirm: "ألغِ الطلب",
      back: "رجوع",
    },
    conversation: {
      title: "المحادثة",
      showAll: "عرض الكل",
      hide: "إخفاء",
      empty: "لا رسائل محفوظة لهذا الطلب.",
      customerOnly: "تظهر هنا رسائل الزبون فقط.",
    },
    empty: {
      active: "ستظهر هنا طلبات واتساب الجديدة تلقائيا.",
      history: "لا طلبات منتهية بعد.",
    },
    fulfillment: { pickup: "استلام", delivery: "توصيل" },
    orderNumber: "#[رقم الطلب]",
    amount: "[السعر] [العملة]",
    itemLine: "[الاسم] ×[الكمية]",
    itemSeparator: " · ",
    maskedPhone: "•••• [آخر 4]",
    time: {
      now: "الآن",
      oneMinute: "منذ دقيقة",
      twoMinutes: "منذ دقيقتين",
      fewMinutes: "منذ [العدد] دقائق",
      manyMinutes: "منذ [العدد] دقيقة",
      oneHour: "منذ ساعة",
      twoHours: "منذ ساعتين",
      fewHours: "منذ [العدد] ساعات",
      manyHours: "منذ [العدد] ساعة",
    },
  });
});

function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (v && typeof v === "object") return Object.values(v).flatMap(strings);
  return [];
}

test("no Arabic-Indic digit anywhere in the dictionary", () => {
  for (const s of strings(DASHBOARD_UI_AR))
    assert.doesNotMatch(s, /[٠-٩۰-۹]/u, s);
});

// --- nextStaffAction — §4 test 1 --------------------------------------------

const EXPECTED: Record<
  OrderStatus,
  Record<FulfillmentType, [string, string] | null>
> = {
  pending_acceptance: {
    pickup: ["accepted", "اقبل"],
    delivery: ["accepted", "اقبل"],
  },
  accepted: {
    pickup: ["preparing", "ابدأ التحضير"],
    delivery: ["preparing", "ابدأ التحضير"],
  },
  preparing: {
    pickup: ["ready", "جاهز"],
    delivery: ["ready", "سلّمناه للسائق"],
  },
  ready: {
    pickup: ["completed", "استلمه الزبون"],
    delivery: ["completed", "وصل للزبون"],
  },
  completed: { pickup: null, delivery: null },
  cancelled: { pickup: null, delivery: null },
  expired: { pickup: null, delivery: null },
};

for (const status of ORDER_STATUSES) {
  for (const fulfillment of ["pickup", "delivery"] as const) {
    test(`nextStaffAction(${status}, ${fulfillment})`, () => {
      const action = nextStaffAction(status, fulfillment);
      const expected = EXPECTED[status][fulfillment];
      assert.deepEqual(action && [action.to, action.label], expected);
    });
  }
}

test("🔴 every button's transition is in STAFF_TRANSITIONS", () => {
  for (const status of ORDER_STATUSES)
    for (const fulfillment of ["pickup", "delivery"] as const) {
      const action = nextStaffAction(status, fulfillment);
      if (action)
        assert.ok(
          STAFF_TRANSITIONS[status].includes(action.to),
          `${status} → ${action.to} is not a staff transition`,
        );
    }
});

test("the six buttons are exactly the six texts of DASHBOARD_UI_AR.actions", () => {
  const labels = new Set<string>();
  for (const status of ORDER_STATUSES)
    for (const fulfillment of ["pickup", "delivery"] as const) {
      const action = nextStaffAction(status, fulfillment);
      if (action) labels.add(action.label);
    }
  assert.deepEqual(
    [...labels].sort(),
    Object.values(DASHBOARD_UI_AR.actions).sort(),
  );
});

// --- relativeTimeAr — §4 test 2, every boundary ------------------------------

const TIMES: [number, string][] = [
  [-3, "الآن"],
  [0, "الآن"],
  [0.9, "الآن"],
  [1, "منذ دقيقة"],
  [2, "منذ دقيقتين"],
  [2.99, "منذ دقيقتين"],
  [3, "منذ 3 دقائق"],
  [10, "منذ 10 دقائق"],
  [11, "منذ 11 دقيقة"],
  [59, "منذ 59 دقيقة"],
  [60, "منذ ساعة"],
  [119, "منذ ساعة"],
  [120, "منذ ساعتين"],
  [179, "منذ ساعتين"],
  [180, "منذ 3 ساعات"],
  [239, "منذ 3 ساعات"],
  [600, "منذ 10 ساعات"],
  [659, "منذ 10 ساعات"],
  [660, "منذ 11 ساعة"],
  [1440, "منذ 24 ساعة"],
];

for (const [minutes, expected] of TIMES)
  test(`relativeTimeAr(${minutes}) → «${expected}»`, () => {
    assert.equal(relativeTimeAr(minutes), expected);
  });

// --- the card's text ---------------------------------------------------------

test("itemsSummaryAr: ×N after a quantity above 1, joined by «·»", () => {
  assert.equal(
    itemsSummaryAr([
      { name: "شاورما", quantity: 2 },
      { name: "بطاطا", quantity: 1 },
    ]),
    "شاورما ×2 · بطاطا",
  );
  assert.equal(itemsSummaryAr([]), "");
  // A name that looks like a slot is never filled a second time.
  assert.equal(
    itemsSummaryAr([{ name: "[الكمية]", quantity: 3 }]),
    "[الكمية] ×3",
  );
});

test("customerLabelAr: the name, or the phone's last four digits alone", () => {
  assert.equal(customerLabelAr({ name: "رهف", phone: "+962790000001" }), "رهف");
  assert.equal(
    customerLabelAr({ name: null, phone: "+962790001234" }),
    "•••• 1234",
  );
  assert.equal(
    customerLabelAr({ name: "  ", phone: "+962790001234" }),
    "•••• 1234",
  );
});

test("orderNumberLabel and amountAr: text as given, never through Number", () => {
  assert.equal(orderNumberLabel(102), "#102");
  assert.equal(amountAr("13.50", "JOD"), "13.50 د.أ");
  assert.equal(amountAr("5.00", "ILS"), "5.00 شيكل");
});

/** An ISO time at `h:m` on the device's clock — the zone the test runs in. */
const localIso = (h: number, m: number) =>
  new Date(2026, 9, 5, h, m).toISOString();

test("clockTime: HH:MM, 24-hour, on the device's clock", () => {
  assert.equal(clockTime(localIso(0, 5)), "00:05");
  assert.equal(clockTime(localIso(12, 0)), "12:00");
  assert.equal(clockTime(localIso(23, 59)), "23:59");
});

test("🔴 clockTime: no Arabic-Indic digit, whatever the browser's language", () => {
  for (let h = 0; h < 24; h++)
    assert.doesNotMatch(clockTime(localIso(h, 7)), /[٠-٩۰-۹]/u);
});

// --- after 24 hours: the date (brief I-9 #6) ---------------------------------

/** A moment on the device's clock — the zone the test runs in. */
const at = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo - 1, d, h, mi).getTime();
const iso = (ms: number) => new Date(ms).toISOString();

test("dateTime: day/month · HH:MM, the year only when it is not this one", () => {
  const now = at(2026, 10, 7, 12, 0);
  assert.equal(dateTime(iso(at(2026, 9, 28, 14, 30)), now), "28/9 · 14:30");
  assert.equal(dateTime(iso(at(2026, 1, 4, 0, 5)), now), "4/1 · 00:05");
  assert.equal(
    dateTime(iso(at(2025, 9, 28, 14, 30)), now),
    "28/9/2025 · 14:30",
  );
});

test("sinceAr: «منذ…» up to 23:59 hours, the date and time from 24:00", () => {
  const now = at(2026, 10, 7, 12, 0);
  const minutesAgo = (m: number) => iso(now - m * 60_000);
  assert.equal(sinceAr(minutesAgo(35), now), "منذ 35 دقيقة");
  assert.equal(sinceAr(minutesAgo(23 * 60 + 59), now), "منذ 23 ساعة");
  assert.equal(sinceAr(minutesAgo(24 * 60), now), "6/10 · 12:00");
  assert.equal(sinceAr(minutesAgo(26 * 60), now), "6/10 · 10:00");
  // A clock ahead of the server's: still «الآن», never a date.
  assert.equal(sinceAr(minutesAgo(-2), now), "الآن");
});

test("historyTime: today HH:MM; before today, its date — 23:50 seen just after midnight", () => {
  const now = at(2026, 10, 7, 0, 10);
  assert.equal(historyTime(iso(at(2026, 10, 7, 0, 5)), now), "00:05");
  assert.equal(historyTime(iso(at(2026, 10, 6, 23, 50)), now), "6/10 · 23:50");
  // At noon, this morning is today still.
  assert.equal(
    historyTime(iso(at(2026, 10, 7, 0, 5)), at(2026, 10, 7, 12, 0)),
    "00:05",
  );
});

test("the new year: last year's moments carry their year", () => {
  const now = at(2026, 1, 1, 0, 10);
  assert.equal(
    historyTime(iso(at(2025, 12, 31, 23, 50)), now),
    "31/12/2025 · 23:50",
  );
  assert.equal(
    sinceAr(iso(at(2025, 12, 31, 9, 0)), at(2026, 1, 1, 10, 0)),
    "31/12/2025 · 09:00",
  );
  // Twenty minutes across midnight: still «منذ…» on the card.
  assert.equal(sinceAr(iso(at(2025, 12, 31, 23, 50)), now), "منذ 20 دقيقة");
});

test("🔴 dates: no Arabic-Indic digit, whatever the browser's language", () => {
  const now = at(2026, 10, 7, 12, 0);
  for (let day = 0; day < 400; day += 7) {
    const t = iso(now - day * 86_400_000 - day * 61_000);
    for (const text of [dateTime(t, now), sinceAr(t, now), historyTime(t, now)])
      assert.doesNotMatch(text, /[٠-٩۰-۹]/u);
  }
});

test("waLink: wa.me with the number alone — a Jordanian and a Palestinian one", () => {
  assert.equal(waLink("+962 79 123 4567"), "https://wa.me/962791234567");
  assert.equal(waLink("+970 59 912 3456"), "https://wa.me/970599123456");
  // As the engine stores a customer: Meta's digits, no + at all.
  assert.equal(waLink("970599123456"), "https://wa.me/970599123456");
});

test("cancelTitleAr: the order number in the dialog's title", () => {
  assert.equal(cancelTitleAr(102), "إلغاء الطلب رقم 102؟");
});
