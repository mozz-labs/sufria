/**
 * ka-2 · the «آخر طلب لك» block, the returning customer's first message, and
 * the «نفسه» words — brief ك §4. Pure: no database.
 *
 * 🔴 Every expected text is written out here by hand, character by character,
 *    from the brief's shape — not built with the functions under test. A
 *    snapshot computed by the code it checks agrees with any change.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  REORDER_HEADER_AR,
  REORDER_HINT_AR,
  REORDER_INPUTS,
  firstMenuMessageAr,
  firstMenuMessageWithReorderAr,
  interpretMessage,
  matchCommand,
  normalizeArabic,
  renderMenuText,
  reorderBlockAr,
} from "@sufria/shared";

test("the two new texts are Mohammed's, verbatim (decision 5)", () => {
  assert.equal(REORDER_HEADER_AR, "آخر طلب لك:");
  assert.equal(REORDER_HINT_AR, "اكتب «نفسه» لتكرار الطلب.");
});

// ---------------------------------------------------------------------------
// The block, to the letter
// ---------------------------------------------------------------------------

test("block: two items, in shekels — qty × today's price, the total of the lines shown", () => {
  assert.equal(
    reorderBlockAr(
      [
        { name: "شاورما دجاج", qty: 2, lineTotalMinor: 3000 },
        { name: "بطاطا", qty: 1, lineTotalMinor: 800 },
      ],
      [],
      "ILS",
    ),
    "آخر طلب لك:\n" +
      "شاورما دجاج ×2 — 30.00 شيكل\n" +
      "بطاطا ×1 — 8.00 شيكل\n" +
      "المجموع 38.00 شيكل\n" +
      "اكتب «نفسه» لتكرار الطلب.",
  );
});

test("block: one item, in dinars", () => {
  assert.equal(
    reorderBlockAr([{ name: "منسف", qty: 1, lineTotalMinor: 1250 }], [], "JOD"),
    "آخر طلب لك:\n" +
      "منسف ×1 — 12.50 د.أ\n" +
      "المجموع 12.50 د.أ\n" +
      "اكتب «نفسه» لتكرار الطلب.",
  );
});

test("block: one item missing — «غير متوفر الآن» under the total, the total without it", () => {
  assert.equal(
    reorderBlockAr(
      [{ name: "شاورما دجاج", qty: 3, lineTotalMinor: 4500 }],
      ["بطاطا"],
      "ILS",
    ),
    "آخر طلب لك:\n" +
      "شاورما دجاج ×3 — 45.00 شيكل\n" +
      "المجموع 45.00 شيكل\n" +
      "الصنف بطاطا غير متوفر الآن.\n" +
      "اكتب «نفسه» لتكرار الطلب.",
  );
});

test("block: two items missing — one line, the plural", () => {
  assert.equal(
    reorderBlockAr(
      [{ name: "فلافل", qty: 50, lineTotalMinor: 3750 }],
      ["بطاطا", "حمّص"],
      "JOD",
    ),
    "آخر طلب لك:\n" +
      "فلافل ×50 — 37.50 د.أ\n" +
      "المجموع 37.50 د.أ\n" +
      "الأصناف بطاطا، حمّص غير متوفرة الآن.\n" +
      "اكتب «نفسه» لتكرار الطلب.",
  );
});

// ---------------------------------------------------------------------------
// The first message, to the letter
// ---------------------------------------------------------------------------

const MENU = renderMenuText(
  [
    {
      number: 1,
      name: "شاورما دجاج",
      priceMinor: 1500,
      categoryId: "c1",
      categoryName: "سندويشات",
    },
    {
      number: 2,
      name: "بطاطا",
      priceMinor: 800,
      categoryId: "c2",
      categoryName: "جانبي",
    },
  ],
  "ILS",
);

test("the returning customer's first message: welcome, blank, block, blank, the whole menu", () => {
  const block = reorderBlockAr(
    [{ name: "شاورما دجاج", qty: 2, lineTotalMinor: 3000 }],
    ["حمّص"],
    "ILS",
  );
  assert.equal(
    firstMenuMessageWithReorderAr("مطعم العرض", block, MENU),
    "أهلا بك في مطعم العرض.\n" +
      "\n" +
      "آخر طلب لك:\n" +
      "شاورما دجاج ×2 — 30.00 شيكل\n" +
      "المجموع 30.00 شيكل\n" +
      "الصنف حمّص غير متوفر الآن.\n" +
      "اكتب «نفسه» لتكرار الطلب.\n" +
      "\n" +
      "القائمة\n" +
      "\n" +
      "سندويشات\n" +
      "1. شاورما دجاج — 15.00 شيكل\n" +
      "\n" +
      "جانبي\n" +
      "2. بطاطا — 8.00 شيكل\n" +
      "\n" +
      "اكتب رقم الصنف · «منيو» · «سلة» · «تم» لما تخلص",
  );
});

test("a new customer's first message is untouched: welcome, newline, menu — no blank line", () => {
  assert.equal(
    firstMenuMessageAr("مطعم العرض", MENU),
    `أهلا بك في مطعم العرض.\n${MENU}`,
  );
});

// ---------------------------------------------------------------------------
// The words (decision 9)
// ---------------------------------------------------------------------------

test("«نفسه» «نفسو» «نفس الطلب» → reorder, the whole message after normalizeArabic", () => {
  for (const raw of ["نفسه", "نفسو", "نفس الطلب", " نفسه! ", "نفسه 👍"]) {
    assert.equal(matchCommand(raw), "reorder", `«${raw}»`);
  }
});

test("«نفسة» normalizes to «نفسه» → reorder", () => {
  assert.equal(normalizeArabic("نفسة"), "نفسه");
  assert.equal(matchCommand("نفسة"), "reorder");
});

test("the list is stored normalized — each entry a fixed point of normalizeArabic", () => {
  for (const entry of REORDER_INPUTS) {
    assert.equal(normalizeArabic(entry), entry, entry);
  }
});

test("«نفسه 2» is not reorder — the whole message, never containment", () => {
  for (const raw of ["نفسه 2", "بدي نفسه", "نفس الطلب بس بدون بصل", "نفس"]) {
    assert.equal(matchCommand(raw), null, `«${raw}»`);
  }
  // …and «نفسه 2» goes to the item parser, like any other text.
  assert.equal(
    interpretMessage("نفسه 2", { "2": crypto.randomUUID() }).kind,
    "items",
  );
});

test("«تم» stays finish, «منيو» menu, «سلة» cart", () => {
  assert.equal(matchCommand("تم"), "finish");
  assert.equal(matchCommand("منيو"), "menu");
  assert.equal(matchCommand("سلة"), "cart");
});

test("interpretMessage hands «نفسه» over as the reorder command", () => {
  const intent = interpretMessage("نفسه", {});
  assert.deepEqual(intent, { kind: "command", command: "reorder" });
});
