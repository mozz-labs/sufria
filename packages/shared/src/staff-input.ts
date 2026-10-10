/**
 * What staff type into the dashboard, made ready to store — brief ي-أ §3,
 * item 3, and Mohammed's decision 6: Arabic digits from a staff keyboard
 * (`٢٫٥٠`) are turned into Western ones by the API before saving.
 *
 * 🔴 Not `normalizeArabic`, and never through it. That one matches a
 *    customer's words against a list, so it rewrites letters (أ → ا, ة → ه,
 *    ى → ي) and drops diacritics; on an item's name that changes what every
 *    customer reads. Here the letters stay exactly as typed — only the
 *    digits, the decimal separator and the spacing are made canonical.
 */
import { whatsappTextLength } from "./menu-message.js";

/** Arabic-Indic (U+0660–0669) and Extended Arabic-Indic (U+06F0–06F9) digits. */
const EASTERN_DIGIT = /[٠-٩۰-۹]/gu;

/** `٢` and `۲` → `2`. Nothing else changes. */
export function toWesternDigits(text: string): string {
  return text.replace(EASTERN_DIGIT, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
  });
}

/** U+066B ARABIC DECIMAL SEPARATOR — `٫`, not the Arabic comma `،`. */
const ARABIC_DECIMAL_SEPARATOR = /٫/gu;

/**
 * A menu price as the database takes it — brief D §3.4, verbatim. Zero is
 * rejected by the pattern itself — `0`, `0.0`, `00.00` — never by turning
 * the text into a number in JS. Six integer digits and two decimals fit
 * `numeric(12,2)`. `\d` is `[0-9]` in JS, with or without the `u` flag.
 *
 * Moved here from `apps/dashboard-api/src/menu/dto/menu-item-fields.ts`,
 * the value unchanged (brief ي-ب §3): the API's DTO, the setup script and
 * the dashboard's menu screen hold a price to this one pattern.
 */
export const MENU_PRICE_PATTERN = /^(?!0+(?:\.0+)?$)\d{1,6}(?:\.\d{1,2})?$/;

/**
 * A price as staff typed it → the text the API holds against
 * `MENU_PRICE_PATTERN`: trimmed, digits Western, `٫` → `.`.
 *
 * 🔴 Nothing else is converted. `2,50`, `٢،٥٠` and `٬` (the Arabic thousands
 *    separator) come out as they went in, and the pattern refuses them: a
 *    comma is a decimal point in one keyboard and a thousands separator in
 *    another, and guessing which turns 2,50 into 250.
 */
export function normalizeStaffPrice(raw: string): string {
  return toWesternDigits(raw.trim()).replace(ARABIC_DECIMAL_SEPARATOR, ".");
}

export type NormalizedMenuPrice =
  { readonly ok: true; readonly price: string } | { readonly ok: false };

/**
 * A price as staff typed it → the text the API will store, or refused: the
 * API's rule exactly (its `MenuPriceSchema`) — `normalizeStaffPrice`, then
 * `MENU_PRICE_PATTERN`. The menu screen checks it before sending
 * (brief ي-ب §3): `٢٫٥٠` is 2.50; `0`, `2,50` and `2.505` are refused.
 */
export function normalizeMenuPrice(raw: string): NormalizedMenuPrice {
  const price = normalizeStaffPrice(raw);
  return MENU_PRICE_PATTERN.test(price) ? { ok: true, price } : { ok: false };
}

/** The longest item name, in characters as WhatsApp counts them (decision 5). */
export const MENU_ITEM_NAME_MAX = 40;

/** Why a name was refused — the API turns each into a 400. */
export type MenuItemNameIssue = "control_character" | "empty" | "too_long";

export type NormalizedMenuItemName =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly issue: MenuItemNameIssue };

/** Any control character (`\p{Cc}`) — a newline and a tab among them. */
const CONTROL_CHARACTER = /\p{Cc}/u;

/**
 * An item's name as staff typed it → the name the customer will read, or why
 * it is refused. Trimmed, every run of whitespace one space, digits Western.
 *
 * 🔴 The control check runs on the input as it came, before anything else:
 *    trimming would hide a trailing newline, and the whitespace collapse
 *    would turn an inner one into a space — a name pasted from somewhere it
 *    had two lines is refused, not silently joined.
 */
export function normalizeMenuItemName(raw: string): NormalizedMenuItemName {
  if (CONTROL_CHARACTER.test(raw)) {
    return { ok: false, issue: "control_character" };
  }
  const name = toWesternDigits(raw.trim().replace(/\s+/gu, " "));
  if (name === "") return { ok: false, issue: "empty" };
  if (whatsappTextLength(name) > MENU_ITEM_NAME_MAX) {
    return { ok: false, issue: "too_long" };
  }
  return { ok: true, name };
}
