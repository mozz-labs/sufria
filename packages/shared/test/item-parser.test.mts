/**
 * محلّل الأصناف والموزّع — ب-3.
 *
 * 🔴 اختبار لكل صف بجدول ب-3 **باسمه**، زي ما طلب تعريف الإنجاز.
 *    المحلّل منطق صافٍ: نص + `menu_map` → نتيجة. ولا قاعدة، فالسويت بتركض
 *    بثواني وبتقدر تغطي حالات حدّية ما بتستاهل جولة قاعدة.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_QTY_PER_ITEM,
  QTY_OVER_CAP_AR,
  interpretMessage,
  parseItems,
  qtyOverCapMessageAr,
  type MenuMap,
} from "@sufria/shared";

/** خريطة من خمسة أصناف — `N = 5`. */
const MENU: MenuMap = {
  "1": "11111111-1111-4111-8111-111111111111",
  "2": "22222222-2222-4222-8222-222222222222",
  "3": "33333333-3333-4333-8333-333333333333",
  "4": "44444444-4444-4444-8444-444444444444",
  "5": "55555555-5555-4555-8555-555555555555",
};

/** `[رقم, كمية]` لكل صنف — الشكل المختصر للمقارنة. */
function pairs(raw: string, menu: MenuMap = MENU): [number, number][] {
  return parseItems(raw, menu).items.map((i) => [i.number, i.qty]);
}

// ---------------------------------------------------------------------------
// جدول ب-3، صفا صفا
// ---------------------------------------------------------------------------

test("الفواصل: مسافة · و · , · ، · + · سطر جديد", () => {
  for (const raw of [
    "1 2",
    "1 و2",
    "1 و 2",
    "1و2",
    "1,2",
    "1،2",
    "1+2",
    "1\n2",
  ]) {
    assert.deepEqual(
      pairs(raw),
      [
        [1, 1],
        [2, 1],
      ],
      `«${raw}»`,
    );
  }
});

test("🔴 «2 5» صنفان — لا «صنف 2 كمية 5»", () => {
  // الغلطة اللي وُجد سطر الإضافة ليمسكها. لو سقط هالاختبار، المحلّل صار يخمّن.
  assert.deepEqual(pairs("2 5"), [
    [2, 1],
    [5, 1],
  ]);
});

test("🔴 رقم مجرّد = رقم صنف دائما، مهما تعدّدت الأرقام", () => {
  assert.deepEqual(pairs("1 2 3"), [
    [1, 1],
    [2, 1],
    [3, 1],
  ]);
  assert.deepEqual(pairs("2 و5"), [
    [2, 1],
    [5, 1],
  ]);
});

test("«2 ×3» صنف 2 كمية 3 — بالعلامات الثلاث", () => {
  for (const marker of ["×", "x", "*"]) {
    assert.deepEqual(pairs(`2 ${marker}3`), [[2, 3]], marker);
    assert.deepEqual(pairs(`2${marker}3`), [[2, 3]], `ملزوقة ${marker}`);
  }
  // X الكبيرة نفس الحرف بحالة تانية، مش علامة جديدة.
  assert.deepEqual(pairs("2 X3"), [[2, 3]]);
});

test("«2 × 3» — العلامة منفصلة بين الاتنين", () => {
  // الرقم بعد علامة صريحة **مش مجرّد**، فقاعدة «مجرّد = صنف» ما بتنطبق عليه.
  assert.deepEqual(pairs("2 × 3"), [[2, 3]]);
});

test("«2 و2» صنف 2 ×2 — الرقم المكرر بتتجمّع كميته", () => {
  assert.deepEqual(pairs("2 و2"), [[2, 2]]);
  assert.deepEqual(pairs("2 و2 و2"), [[2, 3]]);
  assert.deepEqual(pairs("2 ×3 و2 ×2"), [[2, 5]]);
});

test(`سقف ${MAX_QTY_PER_ITEM} للصنف — حماية من «2 ×9999»`, () => {
  const atCap = parseItems(`2 ×${MAX_QTY_PER_ITEM}`, MENU);
  assert.deepEqual(
    atCap.items.map((i) => [i.number, i.qty]),
    [[2, MAX_QTY_PER_ITEM]],
  );

  const over = MAX_QTY_PER_ITEM + 1;
  for (const raw of ["2 ×9999", `2×${over}`, `2 ×${over}`, `2 × ${over}`]) {
    const result = parseItems(raw, MENU);
    assert.deepEqual(result.items, [], `«${raw}»`);
    assert.equal(result.problems.overCapItems.length, 1, `«${raw}»`);
  }
  assert.deepEqual(parseItems("2 ×9999", MENU).problems.overCapItems, [
    { number: 2, requestedQty: 9999 },
  ]);
});

test("🔴 «2 ×30 و2 ×30» تُرفض — السقف على الصنف بعد التجميع", () => {
  // سقف على الرمز المكتوب بينلتف عليه بتقسيم الكمية، فبيصير فلترا مكتوبا
  // فوقه نص بيدّعي قاعدة. التجميع هو اللي بيخلّي «الأقصى 50 للصنف الواحد»
  // صادقة. §13.1
  const result = parseItems("2 ×30 و2 ×30", MENU);
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.problems.overCapItems, [
    { number: 2, requestedQty: 60 },
  ]);
});

test("حجم الطلب نفسه بلا سقف — السقف للصنف الواحد", () => {
  assert.deepEqual(pairs("2 ×15 و2 ×10"), [[2, 25]]);
  assert.deepEqual(pairs(`1 ×${MAX_QTY_PER_ITEM} و2 ×${MAX_QTY_PER_ITEM}`), [
    [1, MAX_QTY_PER_ITEM],
    [2, MAX_QTY_PER_ITEM],
  ]);
});

test("الصنف المتجاوز بينرفض كله، والأصناف التانية بتضل", () => {
  const result = parseItems("2 و1 و1 ×60 و3", MENU);
  assert.deepEqual(
    result.items.map((i) => [i.number, i.qty]),
    [
      [2, 1],
      [3, 1],
    ],
  );
  // `requestedQty` = مجموع الصنف (1 + 60)، مش آخر رقم كتبه الزبون.
  assert.deepEqual(result.problems.overCapItems, [
    { number: 1, requestedQty: 61 },
  ]);
});

test("🔴 الصنف المتجاوز للسقف لا يرفع العدّاد", () => {
  // العدّاد (قيد 2ج) بيرتفع بس لما ما نتعرّف على ولا صنف حقيقي بالرسالة.
  // «2 ×9999» تعرّفنا فيها على الصنف 2 ورفضنا الكمية بسبب مسمّى — الزبون
  // مفهوم، وما لازم يتقدّم نحو رسالة الاستسلام. §13.3
  const result = parseItems("2 ×9999", MENU);
  assert.notEqual(result.outcome, "unparsed");
  assert.equal(result.outcome, "partial");

  // والضابط المقابل: رقم مش بالخريطة **مش** صنف حقيقي — هاد بيرفع العدّاد.
  assert.equal(parseItems("15", MENU).outcome, "unparsed");
});

test("🔴 partial = «تعرّفنا على شي»، لا «أضفنا شي» — §13.2", () => {
  // ب-4 ما بتفترض إن partial معناها صنف انضاف: هون partial بلا ولا صنف.
  const result = parseItems("2 ×9999", MENU);
  assert.equal(result.outcome, "partial");
  assert.equal(result.items.length, 0);
});

test("نص السقف حرفي، وبيحكي نفس الرقم اللي بينفَّذ", () => {
  assert.equal(
    qtyOverCapMessageAr(60),
    "الكمية 60 أكثر من الحد. الأقصى 50 للصنف الواحد.",
  );
  // الـ50 مكتوبة بالنص حرفيا. لو تغيّر الثابت وما تغيّر النص، الزبون
  // بينقال له حد غير اللي بينطبق عليه.
  assert.ok(QTY_OVER_CAP_AR.includes(`الأقصى ${MAX_QTY_PER_ITEM} `));
});

test("🔴 سالب: «×3 و2» لا تضيف الصنف 3", () => {
  // علامة الكمية لازم يسبقها رقم صنف. التطبيع كان يقصّ «×» من طرف الرسالة
  // فتصير «3» = الصنف 3 — صنف ما طلبه الزبون بيوصل سلّته.
  const result = parseItems("×3 و2", MENU);
  assert.deepEqual(
    result.items.map((i) => i.number),
    [2],
  );
  assert.deepEqual(result.problems.unclearParts, ["×3"]);
});

test("علامة بلا رقم قبلها، بأشكالها كلها: جزء غير مفهوم ولا تضيف شي", () => {
  for (const [raw, unclear] of [
    ["*3 و2", "*3"],
    ["× 3 و2", "× 3"],
    // «»» الداخلية ما بيقصّها التطبيع (طرفا الرسالة بس)، فبترجع كما انكتبت.
    ["«×3» و2", "×3»"],
    ["بدون ×3 و2", "بدون ×3"],
  ] as const) {
    const result = parseItems(raw, MENU);
    assert.deepEqual(
      result.items.map((i) => i.number),
      [2],
      `«${raw}»`,
    );
    assert.deepEqual(result.problems.unclearParts, [unclear], `«${raw}»`);
  }
});

test("🔴 رقم برّا menu_map بيتسمّى، وما بيسقّط الأصناف الصحيحة", () => {
  const result = parseItems("2 و15", MENU);
  assert.deepEqual(
    result.items.map((i) => i.number),
    [2],
  );
  assert.deepEqual(result.problems.unknownNumbers, [15]);
  assert.equal(result.outcome, "partial");
});

test("🔴 نص غير رقمي بيرجع للزبون — لا ملاحظة ولا حذف صامت", () => {
  const result = parseItems("2 بدون بصل", MENU);
  assert.deepEqual(
    result.items.map((i) => i.number),
    [2],
  );
  // الأجزاء المتتالية بتتجمّع بجملة وحدة — «بدون بصل»، مش جزأين.
  assert.deepEqual(result.problems.unclearParts, ["بدون بصل"]);
});

// ---------------------------------------------------------------------------
// menu_map هي الحقيقة
// ---------------------------------------------------------------------------

test("🔴 N = عدد مفاتيح menu_map، لا عدد صفوف القاعدة", () => {
  assert.equal(parseItems("1", MENU).menuSize, 5);
  const shrunk: MenuMap = { "1": MENU["1"]!, "2": MENU["2"]! };
  assert.equal(parseItems("1", shrunk).menuSize, 2);
  // الصنف اللي انخفى بيصير رقما غير موجود — حتى لو صفّه لسا بالقاعدة.
  assert.deepEqual(parseItems("3", shrunk).problems.unknownNumbers, [3]);
});

test("المعرّفات بتجي من الخريطة نفسها", () => {
  const items = parseItems("1 3", MENU).items;
  assert.equal(items[0]?.itemId, MENU["1"]);
  assert.equal(items[1]?.itemId, MENU["3"]);
});

// ---------------------------------------------------------------------------
// الحالات الثلاث — قيد 2ج
// ---------------------------------------------------------------------------

test("🔴 ثلاث حالات لا اثنتان: parsed · partial · unparsed", () => {
  assert.equal(parseItems("2", MENU).outcome, "parsed");
  assert.equal(parseItems("2 و15", MENU).outcome, "partial");
  assert.equal(parseItems("2 بدون بصل", MENU).outcome, "partial");
  assert.equal(parseItems("مرحبا كيفك", MENU).outcome, "unparsed");
  assert.equal(parseItems("15", MENU).outcome, "unparsed");
});

test("🔴 رسالة نجح نصها **مش** رسالة غير مفهومة — قيد 2ج", () => {
  // بدون هالتفريق، زبون بيضيف صنفا ويكتب «بدون بصل» بيتقدّم نحو رسالة
  // الاستسلام وهو عم يطلب بنجاح.
  const half = parseItems("2 بدون بصل", MENU);
  assert.notEqual(half.outcome, "unparsed");
  assert.ok(half.items.length > 0);
});

test("رسالة فاضية أو نص محض = unparsed بلا أصناف", () => {
  for (const raw of ["", "   ", "مرحبا", "شو الأخبار"]) {
    const result = parseItems(raw, MENU);
    assert.equal(result.outcome, "unparsed", `«${raw}»`);
    assert.deepEqual(result.items, []);
  }
});

// ---------------------------------------------------------------------------
// الموزّع — الترتيب إلزامي
// ---------------------------------------------------------------------------

test("🔴 سالب: «شيل 2» ما بتضيف ولا صنف", () => {
  // لو مرق المحلّل قبل «شيل»، الصنف 2 بينضاف و«شيل» بترجع «غير واضح» —
  // الزبون طلب حذفا فصار إضافة، وسلّة غلط بتوصل المطبخ بلا رسالة خطأ.
  const intent = interpretMessage("شيل 2", MENU);
  assert.equal(intent.kind, "remove");
  assert.equal(intent.kind === "remove" ? intent.number : null, 2);

  // والضابط المباشر: ولا صنف انضاف بأي حال.
  assert.notEqual(intent.kind, "items");
});

test("🔴 الأوامر الأربعة بتسبق كل شي", () => {
  for (const [raw, command] of [
    ["تم", "finish"],
    ["سلة", "cart"],
    ["منيو", "menu"],
  ] as const) {
    const intent = interpretMessage(raw, MENU);
    assert.equal(intent.kind, "command");
    assert.equal(intent.kind === "command" ? intent.command : null, command);
  }
});

test("🔴 «شيل» مرساة على الطرفين — لا احتواء", () => {
  // نفس ثغرة includes بـب-1، عائدة من باب «شيل». §12.4
  for (const raw of ["بدي شيل 2 صحون من هاد", "شيل 2 كمان", "ممكن شيل 2"]) {
    assert.notEqual(interpretMessage(raw, MENU).kind, "remove", `«${raw}»`);
  }
});

test("«شيل» بلا رقم مش أمر حذف — بتروح للمحلّل", () => {
  const intent = interpretMessage("شيل", MENU);
  assert.equal(intent.kind, "items");
});

test("«شيل ٢» بالأرقام العربية بتشتغل — التطبيع قبل المطابقة", () => {
  const intent = interpretMessage("شيل ٢", MENU);
  assert.equal(intent.kind, "remove");
  assert.equal(intent.kind === "remove" ? intent.number : null, 2);
});

test("رسالة أصناف عادية بتوصل للمحلّل", () => {
  const intent = interpretMessage("2 و5", MENU);
  assert.equal(intent.kind, "items");
  assert.deepEqual(
    intent.kind === "items" ? intent.result.items.map((i) => i.number) : [],
    [2, 5],
  );
});

test("الأرقام العربية-الهندية بتشتغل بالمحلّل كمان", () => {
  assert.deepEqual(pairs("٢ و٥"), [
    [2, 1],
    [5, 1],
  ]);
  assert.deepEqual(pairs("٢ ×٣"), [[2, 3]]);
});
