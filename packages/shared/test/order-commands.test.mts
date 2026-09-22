/**
 * ج-2 — قوائم ما بعد التصفّح (§5)، ونصوصها (§6)، والملخّص.
 *
 * 🔴 السوالب هون مش تكملة عدد. مطابقة بالاحتواء بدل الرسالة كاملة **بتخلق
 *    طلبا** من رسالة رفض الزبون فيها صراحة — والكود بيضل يترجم ويمر، وولا
 *    اختبار قائم بيسقط. كل واحدة مكتوبة باسمها بالبريف، ومكتوبة هون باسمها.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  ADDRESS_TOO_LONG_AR,
  ALL_COMMAND_INPUT_LISTS,
  CANCEL_INPUTS,
  CONFIRM_INPUTS,
  CONFIRM_PROMPT_AR,
  DELIVERY_INPUTS,
  FULFILLMENT_PROMPT_AR,
  MAX_ADDRESS_LENGTH,
  MODIFY_INPUTS,
  ORDER_COMMAND_INPUT_LISTS,
  PICKUP_INPUTS,
  buildOrderSummary,
  fulfillmentAskAr,
  matchCommand,
  matchOrderCommand,
  normalizeArabic,
} from "@sufria/shared";

// ---------------------------------------------------------------------------
// 1. القوائم الخمس — كل مدخل بالبريف بيطابق
// ---------------------------------------------------------------------------

test("كل مدخل من §5 بيطابق أمره", () => {
  const expected = [
    ["pickup", PICKUP_INPUTS, ["استلام", "الاستلام", "من المطعم"]],
    ["delivery", DELIVERY_INPUTS, ["توصيل", "التوصيل", "دليفري"]],
    ["confirm", CONFIRM_INPUTS, ["اكد", "تاكيد"]],
    ["modify", MODIFY_INPUTS, ["عدل", "تعديل"]],
    ["cancel", CANCEL_INPUTS, ["الغ", "الغي", "الغاء"]],
  ] as const;

  for (const [command, list, fromBrief] of expected) {
    assert.deepEqual([...list], fromBrief, `قائمة ${command} خالفت §5`);
    for (const entry of list) {
      assert.equal(matchOrderCommand(entry), command, `«${entry}»`);
    }
  }
});

test("الشكل المكتوب بالعربي بيوصل بعد التطبيع", () => {
  // اللي بيكتبه الزبون فعلا، مش الشكل المخزَّن.
  assert.equal(matchOrderCommand("أكّد"), "confirm");
  assert.equal(matchOrderCommand("تأكيد"), "confirm");
  assert.equal(matchOrderCommand("عدّل"), "modify");
  assert.equal(matchOrderCommand("ألغِ"), "cancel");
  assert.equal(matchOrderCommand("إلغاء"), "cancel");
});

test("التشكيل والتطويل والإيموجي على الطرفين", () => {
  assert.equal(matchOrderCommand("أكّد."), "confirm");
  assert.equal(matchOrderCommand("أكـــّد 👍"), "confirm");
  assert.equal(matchOrderCommand("«توصيل»"), "delivery");
  assert.equal(matchOrderCommand("  استلام  "), "pickup");
  assert.equal(matchOrderCommand("الغاء!!"), "cancel");
});

// ---------------------------------------------------------------------------
// 2. السوالب — كل واحدة باسمها من §10
// ---------------------------------------------------------------------------

test("🔴 «ما بدي اكد» ما بتأكد — بتحتوي «اكد» وبالاحتواء بتخلق طلبا", () => {
  assert.equal(matchOrderCommand("ما بدي اكد"), null);
});

test("🔴 «بدي اكد بس بعدين» ما بتأكد — الزبون قال «بعدين» صراحة", () => {
  assert.equal(matchOrderCommand("بدي اكد بس بعدين"), null);
});

test("🔴 «لا» المجرّدة ما بتلغي — بتحتمل «لا، استنّى»", () => {
  assert.equal(matchOrderCommand("لا"), null);
});

test("🔴 «تم» بـcart_review مش تأكيد — هي كلمة إنهاء التصفّح", () => {
  assert.equal(matchOrderCommand("تم"), null);
  // وبتضل أمر إنهاء بالتصفّح: المطابقان منفصلان، ومنيع الخلط بينهم.
  assert.equal(matchCommand("تم"), "finish");
});

test("🔴 «تمام» و«تمام خلينا نكمل» ما بيأكدوا ولا بيلغوا", () => {
  for (const raw of ["تمام", "تمام خلينا نكمل"]) {
    assert.equal(matchOrderCommand(raw), null, `«${raw}»`);
    assert.equal(matchCommand(raw), null, `«${raw}» كأمر تصفّح`);
  }
});

test("🔴 ولا كلمة موافقة عامة بأي قائمة — قرار منتج مش قرار كود", () => {
  for (const raw of ["اه", "أه", "نعم", "ok", "OK", "اوك", "ماشي", "يلا"]) {
    assert.equal(matchOrderCommand(raw), null, `«${raw}»`);
  }
});

test("ولا مدخل بيطابق لو كان جزءا من جملة", () => {
  for (const [, entries] of ORDER_COMMAND_INPUT_LISTS) {
    for (const entry of entries) {
      assert.equal(matchOrderCommand(`${entry} كمان`), null, `«${entry} كمان»`);
      assert.equal(matchOrderCommand(`بدي ${entry}`), null, `«بدي ${entry}»`);
    }
  }
});

test("رسالة فاضية أو ترقيم أو إيموجي وحدها مش أمر", () => {
  for (const raw of ["", "   ", "...", "👍", "؟؟؟", "\n\t"]) {
    assert.equal(matchOrderCommand(raw), null, JSON.stringify(raw));
  }
});

// ---------------------------------------------------------------------------
// 3. ثوابت القوائم — مطبَّعة، وبلا تكرار بين الثمانية
// ---------------------------------------------------------------------------

test("كل مدخل بالقوائم الثمانية مخزَّن مطبَّعا", () => {
  for (const [listName, entries] of ALL_COMMAND_INPUT_LISTS) {
    for (const entry of entries) {
      assert.equal(
        normalizeArabic(entry),
        entry,
        `${listName}: «${entry}» مش مطبَّع — لازم «${normalizeArabic(entry)}»`,
      );
    }
  }
});

test("🔴 ولا مدخل مكرر بين القوائم الثمانية", () => {
  // خطوة العنوان بتسأل المطابقين معا (§3)، فكلمة بقائمتين بتخلّي الجواب
  // يعتمد على ترتيب النداء لا على اللي كتبه الزبون.
  const seen = new Map<string, string>();
  for (const [listName, entries] of ALL_COMMAND_INPUT_LISTS) {
    for (const entry of entries) {
      const previous = seen.get(entry);
      assert.equal(
        previous,
        undefined,
        `«${entry}» موجود بـ${previous} و${listName} — أي أمر بيفوز؟`,
      );
      seen.set(entry, listName);
    }
  }
});

// ---------------------------------------------------------------------------
// 4. الملخّص — الحالات الثلاث حرفيا (§6)
// ---------------------------------------------------------------------------

const LINES = [
  { menuNumber: 2, name: "شاورما عربي", qty: 2, lineTotalMinor: 1200 },
  { menuNumber: 5, name: "حمص", qty: 1, lineTotalMinor: 250 },
];
const SUBTOTAL = 1450;

test("الملخّص — استلام: بلا سطر رسوم، والمجموع هو مجموع السلّة", () => {
  assert.equal(
    buildOrderSummary(LINES, SUBTOTAL, { type: "pickup" }, "JOD"),
    [
      "ملخّص طلبك:",
      "2 · شاورما عربي ×2 — 12.00 د.أ",
      "5 · حمص ×1 — 2.50 د.أ",
      "المجموع 14.50 د.أ",
      "الاستلام من المطعم",
      "الدفع نقدا.",
      "اكتب «أكّد» لإرسال الطلب، أو «عدّل» أو «ألغِ».",
    ].join("\n"),
  );
});

test("الملخّص — توصيل برسوم: سطر الرسوم، والمجموع بيشملها", () => {
  assert.equal(
    buildOrderSummary(
      LINES,
      SUBTOTAL,
      {
        type: "delivery",
        feeMinor: 150,
        address: "الشميساني، شارع عبد الحميد شرف، بناية 12",
      },
      "JOD",
    ),
    [
      "ملخّص طلبك:",
      "2 · شاورما عربي ×2 — 12.00 د.أ",
      "5 · حمص ×1 — 2.50 د.أ",
      "التوصيل — 1.50 د.أ",
      "المجموع 16.00 د.أ",
      "التوصيل إلى: الشميساني، شارع عبد الحميد شرف، بناية 12",
      "الدفع نقدا.",
      "اكتب «أكّد» لإرسال الطلب، أو «عدّل» أو «ألغِ».",
    ].join("\n"),
  );
});

test("الملخّص — توصيل بلا رسوم: ولا سطر «التوصيل — 0.00 د.أ»", () => {
  const summary = buildOrderSummary(
    LINES,
    SUBTOTAL,
    {
      type: "delivery",
      feeMinor: 0,
      address: "الجاردنز، شارع وصفي التل",
    },
    "JOD",
  );
  assert.equal(
    summary,
    [
      "ملخّص طلبك:",
      "2 · شاورما عربي ×2 — 12.00 د.أ",
      "5 · حمص ×1 — 2.50 د.أ",
      "المجموع 14.50 د.أ",
      "التوصيل إلى: الجاردنز، شارع وصفي التل",
      "الدفع نقدا.",
      "اكتب «أكّد» لإرسال الطلب، أو «عدّل» أو «ألغِ».",
    ].join("\n"),
  );
  assert.ok(!summary.includes("0.00"), "رسوم صفر ما بتنطبع");
});

test("🔴 الملخّص بلا ذيل «شيل» — الأمر ما بيشتغل بـcart_review", () => {
  for (const f of [
    { type: "pickup" },
    { type: "delivery", feeMinor: 150, address: "عمان" },
  ] as const) {
    assert.ok(!buildOrderSummary(LINES, SUBTOTAL, f, "JOD").includes("شيل"));
  }
});

test("🔴 العنوان بينطبع حرفيا — ولا تطبيع على اللي بيقرأه السائق", () => {
  // «ة» و«أ» بيرجعوا زي ما هم: التطبيع للمطابقة وحدها، لا للتخزين ولا للعرض.
  const address = "أم أذينة، عمارة رقم 3، بجانب مطعم الأصيل";
  assert.ok(
    buildOrderSummary(
      LINES,
      SUBTOTAL,
      {
        type: "delivery",
        feeMinor: 150,
        address,
      },
      "JOD",
    ).includes(`التوصيل إلى: ${address}`),
  );
});

test("🔴 اسم صنف فيه خانة أو $& بينطبع حرفيا بالملخّص", () => {
  const summary = buildOrderSummary(
    [{ menuNumber: 1, name: "طبق [المجموع] $&", qty: 1, lineTotalMinor: 500 }],
    500,
    { type: "pickup" },
    "JOD",
  );
  assert.ok(summary.includes("1 · طبق [المجموع] $& ×1 — 5.00 د.أ"));
  assert.ok(summary.includes("المجموع 5.00 د.أ"));
});

test("🔴 المال بالقروش: ولا float بمجموع الملخّص", () => {
  // 6.30 × 2 + رسوم 0.75. بالـfloat بتطلع 13.349999999999998.
  const summary = buildOrderSummary(
    [{ menuNumber: 1, name: "منسف", qty: 2, lineTotalMinor: 1260 }],
    1260,
    { type: "delivery", feeMinor: 75, address: "عمان" },
    "JOD",
  );
  assert.ok(summary.includes("المجموع 13.35 د.أ"), summary);
});

// ---------------------------------------------------------------------------
// 5. نصوص ج الباقية
// ---------------------------------------------------------------------------

test("سؤال الاستلام: الرسوم بتنقال قبل الاختيار، وصفر ما بيطلع", () => {
  assert.equal(
    fulfillmentAskAr(150, "JOD"),
    "استلام من المطعم أو توصيل؟ رسوم التوصيل 1.50 د.أ.\nاكتب «استلام» أو «توصيل».",
  );
  assert.equal(
    fulfillmentAskAr(0, "JOD"),
    "استلام من المطعم أو توصيل؟\nاكتب «استلام» أو «توصيل».",
  );
});

test("🔴 كل رسالة سؤال بتقول حرفيا شو يكتب الزبون", () => {
  // صرامة بلا توجيه = حلقة ما بتنتهي (§2.3).
  assert.ok(fulfillmentAskAr(150, "JOD").includes(FULFILLMENT_PROMPT_AR));
  assert.ok(fulfillmentAskAr(0, "JOD").includes(FULFILLMENT_PROMPT_AR));
  for (const word of ["أكّد", "عدّل", "ألغِ"]) {
    assert.ok(CONFIRM_PROMPT_AR.includes(word), word);
  }
});

test("الـ300 بنص العنوان الطويل هي الثابت نفسه", () => {
  // نص بيوصف قاعدة لازم يوصف اللي بينفَّذ فعلا (§13.1).
  assert.ok(
    ADDRESS_TOO_LONG_AR.includes(String(MAX_ADDRESS_LENGTH)),
    `«${ADDRESS_TOO_LONG_AR}» ما بتذكر ${MAX_ADDRESS_LENGTH}`,
  );
});
