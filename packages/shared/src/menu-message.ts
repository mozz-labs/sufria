/**
 * The menu's message, built in one place: by the engine, which sends it, and
 * by the dashboard API, which refuses a change that would make it too long to
 * send (brief ي-أ §3, item 2). Two copies would drift apart — as the menu's
 * ORDER BY, written twice, already can — and the guard would then measure a
 * message the engine never sends.
 *
 * The rows come from the database, read by each side under its own tenant
 * context; everything from the rows to the length is here.
 */
import {
  MENU_COMMANDS_TAIL_AR,
  MENU_HEADER_AR,
  menuLineAr,
  welcomeMessageAr,
  type Currency,
} from "./domain.js";

/**
 * WhatsApp's limit on one text message.
 *
 * 🔴 A restaurant menu of sixty items goes past it. What is forbidden is
 *    **silent truncation**: a customer sees a menu cut off in the middle of an
 *    item's name and orders a number that is not there, and the restaurant
 *    never learns that half its menu never arrived. The case must surface and
 *    be logged as an error.
 *
 *    Splitting the menu into pages, or a category-selection step, is a
 *    deliberate deferral to a later slice.
 */
export const WHATSAPP_TEXT_LIMIT = 4096;

/**
 * The length WhatsApp counts.
 *
 * 🔴 `[...body].length`, not `body.length`: the latter counts UTF-16 units,
 *    so an emoji counts two. Meta counts characters. The difference would
 *    refuse a valid menu.
 */
export function whatsappTextLength(body: string): number {
  return [...body].length;
}

/** A menu line with its category — what the text is built from. */
export interface MenuTextRow {
  /** Sequential across the whole menu, not within each category. */
  readonly number: number;
  readonly name: string;
  readonly priceMinor: number;
  readonly categoryId: string;
  readonly categoryName: string;
}

/** The text of the menu, from its rows in the customer's order. */
export function renderMenuText(
  rows: readonly MenuTextRow[],
  currency: Currency,
): string {
  const parts: string[] = [MENU_HEADER_AR];
  let currentCategory: string | null = null;

  for (const row of rows) {
    if (row.categoryId !== currentCategory) {
      currentCategory = row.categoryId;
      parts.push("", row.categoryName);
    }
    // 🔴 The template lives in `domain.ts`, inside the guarded dictionary,
    //    not as an inline line here — it used to be here, without a currency,
    //    while the cart had one (brief D §2.3).
    parts.push(menuLineAr(row, currency));
  }

  // 🔴 The tail is added here, in one place, so it comes **once** in every
  //    menu message. Adding it where the menu is sent makes it repeat, or go
  //    missing, depending on who sends.
  parts.push("", MENU_COMMANDS_TAIL_AR);

  return parts.join("\n");
}

/**
 * The first message of a conversation: the welcome with the restaurant's
 * name, then the menu. The longest menu message there is — which is why the
 * dashboard's guard measures this one, not the menu alone.
 */
export function firstMenuMessageAr(
  restaurantName: string,
  menuText: string,
): string {
  return `${welcomeMessageAr(restaurantName)}\n${menuText}`;
}

/**
 * The first message of a returning customer (brief ك, decision 4): the
 * welcome, the «آخر طلب لك» block (`reorderBlockAr`), then the whole menu —
 * a blank line before the block and after it.
 *
 * 🔴 A function of its own, beside `firstMenuMessageAr` and not a parameter
 *    of it: a new customer's first message must not change by one character
 *    (the menu snapshot guards it), and the dashboard's 4096 guard measures
 *    that one, the message every restaurant sends. The engine measures this
 *    one, and sends the plain one instead when it is too long.
 */
export function firstMenuMessageWithReorderAr(
  restaurantName: string,
  reorderBlock: string,
  menuText: string,
): string {
  return `${welcomeMessageAr(restaurantName)}\n\n${reorderBlock}\n\n${menuText}`;
}
