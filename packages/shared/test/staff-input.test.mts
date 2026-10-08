/**
 * ja-2 · what staff type, made ready to store — brief ي-أ §3, item 3, and
 * Mohammed's decisions 5 and 6. Pure: no database.
 *
 * The API holds the price against its own pattern (`MENU_PRICE_PATTERN`) after
 * this normalisation; that a price like `2,50` is then a 400 is asserted by
 * the API's suite. Here: what the normalisation turns into what — and what it
 * leaves alone.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  MENU_ITEM_NAME_MAX,
  normalizeMenuItemName,
  normalizeStaffPrice,
  toWesternDigits,
} from "@sufria/shared";

const nameOf = (raw: string): string => {
  const result = normalizeMenuItemName(raw);
  assert.ok(result.ok, `«${raw}» was refused: ${JSON.stringify(result)}`);
  return result.name;
};

const issueOf = (raw: string): string => {
  const result = normalizeMenuItemName(raw);
  assert.ok(!result.ok, `«${raw}» was accepted as «${JSON.stringify(result)}»`);
  return result.issue;
};

// ---------------------------------------------------------------------------
// The digits
// ---------------------------------------------------------------------------

test("Arabic-Indic and Extended Arabic-Indic digits turn Western, and nothing else does", () => {
  assert.equal(toWesternDigits("٠١٢٣٤٥٦٧٨٩"), "0123456789");
  assert.equal(toWesternDigits("۰۱۲۳۴۵۶۷۸۹"), "0123456789");
  assert.equal(toWesternDigits("شاورما 2 و٣ و۴"), "شاورما 2 و3 و4");
});

// ---------------------------------------------------------------------------
// The price
// ---------------------------------------------------------------------------

test("🔴 ٢٫٥٠ → 2.50: Arabic-Indic digits and the Arabic decimal separator", () => {
  assert.equal(normalizeStaffPrice("٢٫٥٠"), "2.50");
});

test("۲.۵ → 2.5: Extended Arabic-Indic digits", () => {
  assert.equal(normalizeStaffPrice("۲.۵"), "2.5");
});

test("trimmed at both ends; Western and Arabic-Indic digits mixed", () => {
  assert.equal(normalizeStaffPrice("  2.٥٠ "), "2.50");
  assert.equal(normalizeStaffPrice("3"), "3");
});

test("🔴 2,50 stays 2,50: nothing but the digits and ٫ is converted — ، and ٬ neither", () => {
  assert.equal(normalizeStaffPrice("2,50"), "2,50");
  assert.equal(normalizeStaffPrice("٢،٥٠"), "2،50");
  assert.equal(normalizeStaffPrice("٢٬٥٠"), "2٬50");
});

// ---------------------------------------------------------------------------
// The name
// ---------------------------------------------------------------------------

test("🔴 «  شاورما   دجاج » → «شاورما دجاج»: trimmed, every run of spaces one space", () => {
  assert.equal(nameOf("  شاورما   دجاج "), "شاورما دجاج");
  // A no-break space is a space too.
  assert.equal(nameOf("شاورما  دجاج"), "شاورما دجاج");
});

test("«وجبة ٢ قطعة» → «وجبة 2 قطعة»", () => {
  assert.equal(nameOf("وجبة ٢ قطعة"), "وجبة 2 قطعة");
  assert.equal(nameOf("وجبة ۲ قطعة"), "وجبة 2 قطعة");
});

test("🔴 the letters stay as typed — this is not normalizeArabic: أ إ آ ة ى and diacritics untouched", () => {
  const typed = "كُبّة أمّ إبراهيم آخر طبخة على الفحم";
  assert.equal(nameOf(typed), typed);
});

test(`🔴 ${MENU_ITEM_NAME_MAX} characters pass, ${MENU_ITEM_NAME_MAX + 1} do not`, () => {
  assert.equal(MENU_ITEM_NAME_MAX, 40);
  assert.equal(nameOf("ش".repeat(40)), "ش".repeat(40));
  assert.equal(issueOf("ش".repeat(41)), "too_long");
  // Counted after the trim and the collapse, as the customer will read it.
  assert.equal(nameOf(`  ${"ش".repeat(20)}    ${"ش".repeat(19)}  `).length, 40);
});

test("the length is counted as WhatsApp counts it: an emoji is one character", () => {
  // 40 emoji are 80 UTF-16 units; `.length` would refuse them.
  assert.equal(nameOf("🌯".repeat(40)), "🌯".repeat(40));
  assert.equal(issueOf("🌯".repeat(41)), "too_long");
});

test("🔴 a newline is refused — inside the name, and at its end too", () => {
  assert.equal(issueOf("شاورما\nدجاج"), "control_character");
  assert.equal(issueOf("شاورما دجاج\n"), "control_character");
  assert.equal(issueOf("شاورما\r\nدجاج"), "control_character");
});

test("a tab, or any other control character, is refused", () => {
  assert.equal(issueOf("شاورما\tدجاج"), "control_character");
  assert.equal(issueOf("شاورما\u0007"), "control_character");
  assert.equal(issueOf("\u0000شاورما"), "control_character");
});

test("empty, or spaces only, is refused", () => {
  assert.equal(issueOf(""), "empty");
  assert.equal(issueOf("    "), "empty");
});
