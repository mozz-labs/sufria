/**
 * نصوص السلّة — ب-4. حراسة قرار: القاعدة النحوية، وصيغ الجمع حرفيا، والمال
 * بالقروش، وتعبئة الخانات بلا حقن.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  CART_EMPTY_AR,
  CLOSED_AR,
  ALL_CUSTOMER_TEXTS_AR,
  CART_TEXT_TEMPLATES_AR,
  ORDER_STATUS_TEXTS_AR,
  ORDER_TEXT_TEMPLATES_AR,
  ITEM_NAME_SLOT,
  MAX_QTY_PER_ITEM,
  MENU_LINE_AR,
  MENU_NUMBER_SLOT,
  QTYS_OVER_CAP_AR,
  cartMessageAr,
  closedMessageAr,
  formatMinor,
  handoffMessageAr,
  itemNotInCartAr,
  itemsAddedLinesAr,
  itemsRemovedUnavailableLineAr,
  itemsUnavailableLineAr,
  nothingUnderstoodAr,
  overCapLineAr,
  priceToMinor,
  unclearPartsLineAr,
  unknownNumbersLineAr,
  welcomeMessageAr,
} from "@sufria/shared";

// ---------------------------------------------------------------------------
// القاعدة النحوية — §14.6
// ---------------------------------------------------------------------------

/**
 * كل موضع لخانة الاسم: إما يسبقه «الصنف » (الاسم بدل، و«الصنف» هو الفاعل)،
 * أو يتبعه « ×» (الاسم بقائمة، بلا خبر)، أو هو سطر منيو مرقّم.
 *
 * 🔴 **استثناء سطر المنيو ضيّق بالقصد** (بريف د §8.4): الشكل
 *    «[رقم المنيو]. [الاسم]» **حرفيا وفي بداية القالب وبس**. مش «أي شي قبله
 *    نقطة»، ولا «[رقم المنيو]. » بنص جملة — التليين العام بيمرّق فاعلا بعد
 *    أول نقطة بأي جملة.
 */
const MENU_LINE_PREFIX = `${MENU_NUMBER_SLOT}. `;
function nameNeverSubject(template: string): boolean {
  let at = template.indexOf(ITEM_NAME_SLOT);
  while (at !== -1) {
    const before = template.slice(0, at);
    const after = template.slice(at + ITEM_NAME_SLOT.length);
    if (
      !before.endsWith("الصنف ") &&
      !after.startsWith(" ×") &&
      before !== MENU_LINE_PREFIX
    )
      return false;
    at = template.indexOf(ITEM_NAME_SLOT, at + 1);
  }
  return true;
}

test("🔴 دليل الحارس: قالب الاسم فيه فاعل بيسقط", () => {
  // بلا هالدليل، حارس ما رفض شي بحياته ما بيثبت شي.
  assert.equal(nameNeverSubject(`${ITEM_NAME_SLOT} غير متوفر الآن.`), false);
  assert.equal(nameNeverSubject(`تم تجهيز ${ITEM_NAME_SLOT} للتوصيل.`), false);
  assert.equal(
    nameNeverSubject(`الصنف ${ITEM_NAME_SLOT} غير متوفر الآن.`),
    true,
  );
  assert.equal(nameNeverSubject(`${ITEM_NAME_SLOT} ×2`), true);
});

test("🔴 دليل استثناء سطر المنيو: الشكل الحرفي بأول القالب وبس", () => {
  // الحالة اللي الاستثناء موجود عشانها.
  assert.equal(
    nameNeverSubject(`${MENU_NUMBER_SLOT}. ${ITEM_NAME_SLOT} — [السعر]`),
    true,
  );
  assert.equal(nameNeverSubject(MENU_LINE_AR), true);
  // 🔴 السالب المطلوب: قالب بيبلّش بالاسم بلا رقم قبله بيضل مرفوضا.
  assert.equal(nameNeverSubject(`${ITEM_NAME_SLOT} — [السعر]`), false);
  // ومش تليين عام: نفس البادئة بنص جملة، أو رقم حرفي بدل الخانة، أو نقطة
  // بآخر جملة قبل الاسم — كلها بتضل مرفوضة.
  assert.equal(
    nameNeverSubject(
      `اخترت ${MENU_NUMBER_SLOT}. ${ITEM_NAME_SLOT} غير متوفر الآن.`,
    ),
    false,
  );
  assert.equal(nameNeverSubject(`1. ${ITEM_NAME_SLOT} غير متوفر الآن.`), false);
  assert.equal(
    nameNeverSubject(`انتهى الطلب. ${ITEM_NAME_SLOT} غير متوفر الآن.`),
    false,
  );
});

test("🔴 اسم الصنف لا يكون فاعلا أبدا — بكل نص بيوصل الزبون", () => {
  // «كبسة لحم غير متوفر» غلط و«منسف غير متوفرة» غلط. «الصنف» مذكّر وبيحمل
  // الخبر عن أي اسم.
  const withName = ALL_CUSTOMER_TEXTS_AR.filter((t) =>
    t.includes(ITEM_NAME_SLOT),
  );
  assert.ok(withName.length >= 5, "الحارس لازم يلاقي قوالب يفحصها");
  for (const template of withName) {
    assert.ok(nameNeverSubject(template), `الاسم فاعل في: ${template}`);
  }
});

test("ولا رقم عربي-هندي بأي نص بيوصل الزبون", () => {
  for (const template of ALL_CUSTOMER_TEXTS_AR) {
    assert.doesNotMatch(template, /[٠-٩۰-۹]/u, template);
  }
});

// 🔴 توسيع الحارسين بلا فايدة لو القائمة نفسها فرغت من نصوص ج ورسائل الحالة.
//    بدون هالفحص، حدا بيشيل سطرا من `ALL_CUSTOMER_TEXTS_AR` والحارسين بيضلوا
//    خضر — بيفحصوا نصوص السلّة وبس، زي ما كانوا قبل §15.6 بالضبط.
test("🔴 الحراسة بتشمل نصوص ج ورسائل الحالة، مش نصوص السلّة وحدها", () => {
  for (const template of [...ORDER_TEXT_TEMPLATES_AR, ...ORDER_STATUS_TEXTS_AR])
    assert.ok(
      ALL_CUSTOMER_TEXTS_AR.includes(template),
      `«${template}» برّا الحراسة`,
    );
  assert.ok(
    ORDER_STATUS_TEXTS_AR.includes(
      "استلمنا طلبك رقم [رقم الطلب] — التأكيد خلال دقائق.",
    ),
    "رسالة إنشاء الطلب لازم تكون محروسة — كانت برّا القاموس كليا",
  );
  assert.equal(
    ALL_CUSTOMER_TEXTS_AR.length,
    CART_TEXT_TEMPLATES_AR.length +
      ORDER_TEXT_TEMPLATES_AR.length +
      ORDER_STATUS_TEXTS_AR.length,
  );
});

// ---------------------------------------------------------------------------
// المفرد والجمع — حرفيا من §5 و§14.4
// ---------------------------------------------------------------------------

test("الرقم غير الموجود: مفرد وجمع حرفيا", () => {
  assert.equal(
    unknownNumbersLineAr([15], 5),
    "الرقم 15 غير موجود في المنيو. الأرقام من 1 إلى 5.",
  );
  assert.equal(
    unknownNumbersLineAr([15, 16], 5),
    "الأرقام 15، 16 غير موجودة في المنيو. الأرقام من 1 إلى 5.",
  );
});

test("الكمية فوق السقف: مفرد وجمع حرفيا، والـ50 هي الثابت", () => {
  assert.equal(
    overCapLineAr([60]),
    "الكمية 60 أكثر من الحد. الأقصى 50 للصنف الواحد.",
  );
  assert.equal(
    overCapLineAr([60, 70]),
    "الكميات 60، 70 أكثر من الحد. الأقصى 50 للصنف الواحد.",
  );
  assert.ok(QTYS_OVER_CAP_AR.includes(`الأقصى ${MAX_QTY_PER_ITEM} `));
});

test("الجزء غير الواضح: مفرد وجمع حرفيا، وكل جزء بين «»", () => {
  assert.equal(
    unclearPartsLineAr(["بدون بصل"]),
    "الجزء «بدون بصل» غير واضح — الطلب بالأرقام فقط.",
  );
  assert.equal(
    unclearPartsLineAr(["بدون بصل", "كتير"]),
    "الأجزاء «بدون بصل»، «كتير» غير واضحة — الطلب بالأرقام فقط.",
  );
});

test("الصنف غير المتوفر: مفرد وجمع حرفيا، وسطر واحد للاثنين", () => {
  assert.equal(
    itemsUnavailableLineAr(["كبسة لحم"]),
    "الصنف كبسة لحم غير متوفر الآن.",
  );
  // جمع غير العاقل ← مؤنث مفرد: «الأصناف … غير متوفرة» بتصلح لأي خليط أطباق.
  assert.equal(
    itemsUnavailableLineAr(["كبسة لحم", "منسف"]),
    "الأصناف كبسة لحم، منسف غير متوفرة الآن.",
  );
});

test("المحذوف من السلّة: مفرد وجمع حرفيا، ومتميّز عن رفض الإضافة", () => {
  assert.equal(
    itemsRemovedUnavailableLineAr(["حمص"]),
    "الصنف حمص لم يعد متوفرا وحُذف من سلّتك.",
  );
  assert.equal(
    itemsRemovedUnavailableLineAr(["حمص", "متبل"]),
    "الأصناف حمص، متبل لم تعد متوفرة وحُذفت من سلّتك.",
  );
  // 🔴 نصّان مختلفان لحدثين مختلفين: ذاك بيرفض إضافة طلبها الزبون،
  //    وهاد بيخبّر عن حذف صار بلا ما يطلب. توحيدهم بيخفي نقص السلّة.
  assert.notEqual(
    itemsRemovedUnavailableLineAr(["حمص"]),
    itemsUnavailableLineAr(["حمص"]),
  );
});

test("الصنف مش بالسلّة، ولا شيء مفهوم، والاستسلام", () => {
  assert.equal(itemNotInCartAr("منسف"), "الصنف منسف غير موجود في سلّتك.");
  assert.equal(
    nothingUnderstoodAr(5),
    "الأرقام من 1 إلى 5. اكتب «منيو» لعرض القائمة.",
  );
  assert.equal(handoffMessageAr("0790000099"), "للطلب مباشرة: 0790000099");
});

// ---------------------------------------------------------------------------
// سطر الإضافة وعرض السلّة
// ---------------------------------------------------------------------------

test("إضافة صنف واحد: سطر واحد، والمجموع مجموع السلّة", () => {
  assert.deepEqual(
    itemsAddedLinesAr([{ name: "شاورما عربي", qty: 2 }], 1450, "JOD"),
    ["أضفت: شاورما عربي ×2 — المجموع 14.50 د.أ"],
  );
});

test("إضافة أكثر من صنف: رأس، سطر لكل صنف، ثم المجموع", () => {
  assert.deepEqual(
    itemsAddedLinesAr(
      [
        { name: "حمص", qty: 1 },
        { name: "متبل", qty: 2 },
      ],
      850,
      "JOD",
    ),
    ["أضفت:", "حمص ×1", "متبل ×2", "المجموع 8.50 د.أ"],
  );
});

test("🔴 ولا صنف انضاف = ولا سطر «أضفت:» ولا مجموع", () => {
  // طباعة مجموع ما تغيّر بتقول للزبون إن إشي صار، وما صار. §14.1-2
  assert.deepEqual(itemsAddedLinesAr([], 1450, "JOD"), []);
});

test("عرض السلّة برقم المنيو، والمجموع، وذيل «شيل»", () => {
  assert.equal(
    cartMessageAr(
      [
        { menuNumber: 2, name: "شاورما عربي", qty: 2, lineTotalMinor: 1200 },
        { menuNumber: 5, name: "حمص", qty: 1, lineTotalMinor: 250 },
      ],
      1450,
      "JOD",
    ),
    [
      "سلّتك:",
      "2 · شاورما عربي ×2 — 12.00 د.أ",
      "5 · حمص ×1 — 2.50 د.أ",
      "المجموع 14.50 د.أ",
      "لحذف صنف: «شيل» ورقمه",
    ].join("\n"),
  );
  assert.equal(cartMessageAr([], 0, "JOD"), CART_EMPTY_AR);
});

test("صنف بلا رقم بالخريطة الحالية: السطر بلا بادئة، ما في رقم صادق", () => {
  assert.equal(
    cartMessageAr(
      [{ menuNumber: null, name: "حمص", qty: 1, lineTotalMinor: 250 }],
      250,
      "JOD",
    ).split("\n")[1],
    "حمص ×1 — 2.50 د.أ",
  );
});

// ---------------------------------------------------------------------------
// المال والخانات
// ---------------------------------------------------------------------------

test("🔴 المال بالقروش: ولا float بالمجموع", () => {
  assert.equal(priceToMinor("6.30"), 630);
  assert.equal(priceToMinor("2.50"), 250);
  assert.equal(priceToMinor("12"), 1200);
  // 0.1 + 0.2 بالـfloat = 0.30000000000000004. بالقروش = 30 بالضبط.
  assert.equal(
    formatMinor(priceToMinor("0.10") + priceToMinor("0.20")),
    "0.30",
  );
  assert.equal(formatMinor(630 * 2), "12.60");
});

test("🔴 اسم مطعم فيه $& بينطبع حرفيا — الترحيب والإغلاق بمرور واحد", () => {
  // نصّا ب-2 كانوا لسا على `String.replace` ببديل نصي، فـ`$&` بالقيمة
  // كانت تُفسّر نمطا وتحط اسم الخانة نفسها محلها. واسم المطعم
  // قيمة بيكتبها المطعم، مش ثابت بالكود.
  assert.equal(welcomeMessageAr("مطعم $& الشام"), "أهلا بك في مطعم $& الشام.");
  assert.equal(
    closedMessageAr({ opensAt: "$&", closesAt: "23:00" }),
    "المطعم مغلق حاليا. نستقبل الطلبات من $& إلى 23:00.",
  );
  // والعلّة التانية للـ`replace` المتتالية: قيمة فيها خانة بتتعبّى
  // بالخطوة الجاية — وقتها «إلى» كانت بتنزل على موضع «من».
  assert.equal(
    closedMessageAr({ opensAt: "[إلى]", closesAt: "23:00" }),
    "المطعم مغلق حاليا. نستقبل الطلبات من [إلى] إلى 23:00.",
  );
  assert.equal(closedMessageAr(null), CLOSED_AR);
});

test("🔴 اسم صنف فيه خانة أو $& بينطبع حرفيا — لا حقن بين الخانات", () => {
  // `replace` متتالية كانت بتعبّي [الكمية] جوّا الاسم، و$& كانت بتنفسّر نمطا.
  assert.deepEqual(
    itemsAddedLinesAr([{ name: "صنف $& [الكمية]", qty: 2 }], 500, "JOD"),
    ["أضفت: صنف $& [الكمية] ×2 — المجموع 5.00 د.أ"],
  );
});
