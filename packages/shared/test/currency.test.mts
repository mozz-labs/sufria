/**
 * د-1 — العملة خانة بالقوالب (بريف د §2.2 و§8.4)، وسطر المنيو (§2.3)، وسطر
 * الدفع (§2.4). النصف الصافي: بلا قاعدة، فكل قرار نصي بينفحص هون حرفيا.
 *
 * 🔴 **`JOD` بالاختبارات القائمة بيطلع نفس النص حرفيا** — الاختبارات هناك
 *    ما تغيّر ولا متوقَّع فيها. هون بينفحص اللي انضاف: `ILS` بكل دالة فيها
 *    مبلغ، وإنه ولا نص بيطلع وفيه خانة ما انعبّت.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ALL_CUSTOMER_TEXTS_AR,
  CART_LINE_AR,
  CART_LINE_UNNUMBERED_AR,
  CART_TOTAL_LINE_AR,
  CURRENCIES,
  CURRENCY_LABEL_AR,
  CURRENCY_SLOT,
  FULFILLMENT_ASK_WITH_FEE_AR,
  ITEM_ADDED_AR,
  MENU_LINE_AR,
  SUMMARY_FEE_LINE_AR,
  SUMMARY_PAYMENT_LINE_AR,
  SUMMARY_PICKUP_LINE_AR,
  buildOrderSummary,
  cartMessageAr,
  fulfillmentAskAr,
  itemsAddedLinesAr,
  menuLineAr,
  type Currency,
  type SummaryFulfillment,
} from "@sufria/shared";

/** خانة بين قوسين، أو قوس معقوف — أي أثر لقالب ما انعبّى. */
const UNFILLED = /\[[^\]]*\]|\{/u;

const LINES = [
  { menuNumber: 2, name: "شاورما دجاج", qty: 2, lineTotalMinor: 500 },
  { menuNumber: null, name: "حمص", qty: 1, lineTotalMinor: 250 },
];
const DELIVERY: SummaryFulfillment = {
  type: "delivery",
  feeMinor: 150,
  address: "غزة، شارع الوحدة",
};

/**
 * كل نص فيه مبلغ، بكل فروعه: مفرد وجمع، برقم وبلا رقم، برسوم وبلاها. أسطر
 * الإضافة بتنضم برسالة وحدة زي ما المحرّك بيبعتها — رأس «أضفت:» لحاله ما
 * فيه مبلغ.
 */
function everyAmountText(currency: Currency): string[] {
  return [
    menuLineAr({ number: 1, name: "شاورما دجاج", priceMinor: 250 }, currency),
    itemsAddedLinesAr([{ name: "شاورما دجاج", qty: 2 }], 500, currency).join(
      "\n",
    ),
    itemsAddedLinesAr(
      [
        { name: "شاورما دجاج", qty: 2 },
        { name: "حمص", qty: 1 },
      ],
      750,
      currency,
    ).join("\n"),
    cartMessageAr(LINES, 750, currency),
    buildOrderSummary(LINES, 750, { type: "pickup" }, currency),
    buildOrderSummary(LINES, 750, DELIVERY, currency),
    fulfillmentAskAr(150, currency),
  ];
}

// ---------------------------------------------------------------------------
// التسميات، والمرآة
// ---------------------------------------------------------------------------

test("التسميات حرفيا: JOD ← د.أ · ILS ← شيكل", () => {
  assert.deepEqual(CURRENCY_LABEL_AR, { JOD: "د.أ", ILS: "شيكل" });
  assert.deepEqual(
    Object.keys(CURRENCY_LABEL_AR).sort(),
    [...CURRENCIES].sort(),
  );
});

test("🔴 CURRENCIES مرآة CHECK بـ0011 — SQL هو المصدر", () => {
  // عملة بالـCHECK بلا تسمية بتطلع للزبون «[العملة]»، وتسمية بلا CHECK ما
  // بتوصلها القاعدة أبدا. الاتنين غلط بصمت، فالمقارنة مع الملف نفسه.
  const dir = fileURLToPath(
    new URL("../../../db/migrations/", import.meta.url),
  );
  const file = readdirSync(dir).find((f) => f.startsWith("0011_"));
  assert.ok(file, "هجرة 0011 مش موجودة");
  const sql = readFileSync(join(dir, file), "utf8");
  const check = /CHECK \(currency IN \(([^)]*)\)\)/u.exec(sql);
  assert.ok(check, "CHECK العملة مش موجود بـ0011");
  const inSql = [...check[1]!.matchAll(/'([A-Z]+)'/gu)].map((m) => m[1]);
  assert.deepEqual(inSql, [...CURRENCIES]);
});

// ---------------------------------------------------------------------------
// القوالب الستة
// ---------------------------------------------------------------------------

test("🔴 القوالب الستة فيها خانة العملة، ولا «د.أ» ثابتة بأي نص للزبون", () => {
  for (const template of [
    ITEM_ADDED_AR,
    CART_TOTAL_LINE_AR,
    CART_LINE_AR,
    CART_LINE_UNNUMBERED_AR,
    FULFILLMENT_ASK_WITH_FEE_AR,
    SUMMARY_FEE_LINE_AR,
  ]) {
    assert.ok(template.includes(CURRENCY_SLOT), `بلا خانة عملة: ${template}`);
  }
  for (const template of ALL_CUSTOMER_TEXTS_AR) {
    assert.ok(!template.includes("د.أ"), `«د.أ» ثابتة في: ${template}`);
  }
});

test("🔴 مطعم ILS: كل نص فيه مبلغ بـ«شيكل»، ولا «د.أ»", () => {
  for (const text of everyAmountText("ILS")) {
    assert.ok(text.includes("شيكل"), text);
    assert.ok(!text.includes("د.أ"), text);
  }
  // حرفيا، سطر من كل نوع.
  assert.equal(
    fulfillmentAskAr(150, "ILS"),
    "استلام من المطعم أو توصيل؟ رسوم التوصيل 1.50 شيكل.\nاكتب «استلام» أو «توصيل».",
  );
  const summary = buildOrderSummary(LINES, 750, DELIVERY, "ILS").split("\n");
  assert.ok(summary.includes("2 · شاورما دجاج ×2 — 5.00 شيكل"));
  assert.ok(summary.includes("حمص ×1 — 2.50 شيكل"));
  assert.ok(summary.includes("التوصيل — 1.50 شيكل"));
  assert.ok(summary.includes("المجموع 9.00 شيكل"));
  assert.deepEqual(
    itemsAddedLinesAr([{ name: "شاورما دجاج", qty: 2 }], 500, "ILS"),
    ["أضفت: شاورما دجاج ×2 — المجموع 5.00 شيكل"],
  );
});

test("مطعم JOD: كل نص فيه مبلغ بـ«د.أ»، ولا «شيكل»", () => {
  for (const text of everyAmountText("JOD")) {
    assert.ok(text.includes("د.أ"), text);
    assert.ok(!text.includes("شيكل"), text);
  }
});

test("🔴 ولا نص صادر فيه خانة ما انعبّت — بالعملتين", () => {
  for (const currency of CURRENCIES) {
    for (const text of everyAmountText(currency)) {
      assert.doesNotMatch(text, UNFILLED, text);
    }
  }
});

// ---------------------------------------------------------------------------
// سطر المنيو — §2.3 و§8.4
// ---------------------------------------------------------------------------

test("سطر المنيو بالعملة، وبنفس شكل السطر القائم", () => {
  assert.equal(
    menuLineAr({ number: 1, name: "شاورما دجاج", priceMinor: 250 }, "JOD"),
    "1. شاورما دجاج — 2.50 د.أ",
  );
  assert.equal(
    menuLineAr({ number: 1, name: "شاورما دجاج", priceMinor: 250 }, "ILS"),
    "1. شاورما دجاج — 2.50 شيكل",
  );
  assert.ok(ALL_CUSTOMER_TEXTS_AR.includes(MENU_LINE_AR), "برّا الحراسة");
});

test("🔴 سطر المنيو بيمرق بـformatMinor: منزلتين دايما، وبلا float", () => {
  // "3" من القاعدة ← 300 قرش ← "3.00". و6.30 ما بتصير 6.3 ولا 6.29.
  assert.equal(
    menuLineAr({ number: 2, name: "متبل", priceMinor: 300 }, "JOD"),
    "2. متبل — 3.00 د.أ",
  );
  assert.equal(
    menuLineAr({ number: 3, name: "منسف", priceMinor: 630 }, "JOD"),
    "3. منسف — 6.30 د.أ",
  );
});

test("🔴 اسم صنف فيه خانة أو $& بينطبع حرفيا بسطر المنيو", () => {
  assert.equal(
    menuLineAr({ number: 1, name: "طبق [العملة] $&", priceMinor: 500 }, "ILS"),
    "1. طبق [العملة] $& — 5.00 شيكل",
  );
});

// ---------------------------------------------------------------------------
// سطر الدفع — §2.4
// ---------------------------------------------------------------------------

test("الملخّص: «الدفع نقدا.» للاستلام والتوصيل، بلا «عند الاستلام»", () => {
  assert.equal(SUMMARY_PAYMENT_LINE_AR, "الدفع نقدا.");
  for (const f of [{ type: "pickup" }, DELIVERY] as const) {
    const lines = buildOrderSummary(LINES, 750, f, "JOD").split("\n");
    assert.ok(lines.includes("الدفع نقدا."), lines.join("\n"));
    assert.ok(!lines.join("\n").includes("عند الاستلام"));
  }
  // السبب: بطلب الاستلام بيجي مباشرة بعد «الاستلام من المطعم».
  const pickup = buildOrderSummary(LINES, 750, { type: "pickup" }, "JOD").split(
    "\n",
  );
  assert.equal(
    pickup[pickup.indexOf(SUMMARY_PICKUP_LINE_AR) + 1],
    SUMMARY_PAYMENT_LINE_AR,
  );
});
