import { z } from "zod";
import {
  MENU_ITEM_NAME_MAX,
  normalizeMenuItemName,
  normalizeStaffPrice,
  type MenuItemNameIssue,
} from "@sufria/shared";

/**
 * Brief D §3.4, verbatim. Zero is rejected by the pattern itself — `0`,
 * `0.0`, `00.00` — never by turning the text into a number in JS. Six integer
 * digits and two decimals fit `numeric(12,2)`.
 *
 * `\d` is `[0-9]` in JS, with or without the `u` flag. Since brief ي-أ
 * (decision 6) the price reaches this pattern only through
 * `normalizeStaffPrice`: `٢٫٥٠` from a staff keyboard is 2.50, not a 400.
 * Anything else that is not this pattern stays a 400 — `2,50`, `٢،٥٠`.
 *
 * Also what the setup script validates a menu file's prices against (brief E
 * §2.2) — with no normalisation there: that file is a developer's.
 */
export const MENU_PRICE_PATTERN = /^(?!0+(?:\.0+)?$)\d{1,6}(?:\.\d{1,2})?$/;

/**
 * A price as staff send it: normalised (trimmed, digits Western, `٫` → `.`),
 * then held against the pattern. The value the service receives is the
 * normalised text.
 */
export const MenuPriceSchema = z
  .string()
  .transform(normalizeStaffPrice)
  .pipe(
    z
      .string()
      .regex(
        MENU_PRICE_PATTERN,
        "price must be greater than zero, with at most six digits and two decimals",
      ),
  );

const NAME_ISSUES: Record<MenuItemNameIssue, string> = {
  control_character:
    "name must not contain a newline, a tab or any control character",
  empty: "name must not be blank",
  too_long: `name must be at most ${MENU_ITEM_NAME_MAX} characters`,
};

/**
 * An item's name as staff send it: normalised by `normalizeMenuItemName`
 * (brief ي-أ §3 — trimmed, one space per run, digits Western, letters as
 * typed), or a 400 naming why. The service receives the normalised name.
 */
export const MenuItemNameSchema = z.string().transform((raw, ctx) => {
  const result = normalizeMenuItemName(raw);
  if (result.ok) return result.name;
  ctx.addIssue({ code: "custom", message: NAME_ISSUES[result.issue] });
  return z.NEVER;
});
