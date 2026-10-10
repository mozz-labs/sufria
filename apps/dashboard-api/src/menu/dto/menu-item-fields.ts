import { z } from "zod";
import {
  MENU_ITEM_NAME_MAX,
  MENU_PRICE_PATTERN,
  normalizeMenuItemName,
  normalizeStaffPrice,
  type MenuItemNameIssue,
} from "@sufria/shared";

/**
 * A price as staff send it: normalised (trimmed, digits Western, `٫` → `.`),
 * then held against `MENU_PRICE_PATTERN` — brief D §3.4, in
 * `packages/shared` since brief ي-ب §3, so the menu screen checks the very
 * rule. Since brief ي-أ (decision 6) the price reaches the pattern only
 * through `normalizeStaffPrice`: `٢٫٥٠` from a staff keyboard is 2.50, not a
 * 400. Anything else that is not the pattern stays a 400 — `2,50`, `٢،٥٠`.
 * The value the service receives is the normalised text.
 *
 * The setup script validates a menu file's prices against the same pattern
 * (brief E §2.2) — with no normalisation there: that file is a developer's.
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
