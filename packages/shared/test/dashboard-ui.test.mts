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
  itemsSummaryAr,
  nextStaffAction,
  orderNumberLabel,
  relativeTimeAr,
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

test("waLink: wa.me with the number alone — a Jordanian and a Palestinian one", () => {
  assert.equal(waLink("+962 79 123 4567"), "https://wa.me/962791234567");
  assert.equal(waLink("+970 59 912 3456"), "https://wa.me/970599123456");
  // As the engine stores a customer: Meta's digits, no + at all.
  assert.equal(waLink("970599123456"), "https://wa.me/970599123456");
});

test("cancelTitleAr: the order number in the dialog's title", () => {
  assert.equal(cancelTitleAr(102), "إلغاء الطلب رقم 102؟");
});
