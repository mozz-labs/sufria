/**
 * The menu screen's decisions, apart from React (brief ي-ب §6–§7): what a
 * row shows, what «حفظ» sends, when «لم يُحفظ» shows, and which line an
 * answer leads to. The components only render what these return, so the
 * rules are tested without a browser (the pattern of `features/orders/lib/`).
 */
import {
  DASHBOARD_UI_AR,
  amountAr,
  menuTooLongAr,
  normalizeMenuItemName,
  normalizeMenuPrice,
  type Currency,
  type MenuItemListItem,
  type UpdateMenuItemRequest,
} from "@sufria/shared";
import type { ApiError } from "../../../shared/api/http.ts";

const T = DASHBOARD_UI_AR.menu;

export type RowView = {
  name: string;
  /** «2.50 د.أ» — isolated on the screen (`.num`). */
  amount: string;
  /** «متاح» or «مطفأ»: the state in a word, never by colour alone. */
  status: string;
  /** «أطفئ» for an available item, «شغّل» for one switched off. */
  toggle: { label: string; isAvailable: boolean };
};

export function rowView(item: MenuItemListItem, currency: Currency): RowView {
  return {
    name: item.name,
    amount: amountAr(item.price, currency),
    status: item.isAvailable ? T.status.available : T.status.off,
    toggle: item.isAvailable
      ? { label: T.turnOff, isAvailable: false }
      : { label: T.turnOn, isAvailable: true },
  };
}

/** A row of «المُزالة» (brief ي-ب §7): its name, price and category. */
export function removedRowView(
  item: MenuItemListItem,
  currency: Currency,
): { name: string; amount: string; category: string } {
  return {
    name: item.name,
    amount: amountAr(item.price, currency),
    category: item.categoryName,
  };
}

/**
 * The menu under its category headings, in the order `GET /menu-items`
 * returned it — the customer's (brief ي-ب §6). A category's items are
 * consecutive there; a heading for each run.
 */
export function byCategory<T extends MenuItemListItem>(
  items: readonly T[],
): { id: string; name: string; items: T[] }[] {
  const groups: { id: string; name: string; items: T[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.id === item.categoryId) last.items.push(item);
    else
      groups.push({
        id: item.categoryId,
        name: item.categoryName,
        items: [item],
      });
  }
  return groups;
}

/** How many items are switched off: «المطفأة: [العدد]» while over 0. */
export function offCount(items: readonly MenuItemListItem[]): number {
  return items.filter((item) => !item.isAvailable).length;
}

/**
 * A valid price's canonical text, as `numeric(12,2)` gives it back: «2.5»
 * and «02.50» are «2.50». Text alone — never through `Number`.
 */
function canonicalPrice(price: string): string {
  const [whole = "", fraction = ""] = price.split(".");
  return `${whole.replace(/^0+(?=\d)/, "")}.${fraction.padEnd(2, "0")}`;
}

export type Draft = { name: string; price: string };

/** What a field holds once checked: the value the API would store, or why not. */
type Checked = { value: string } | { error: string };

/**
 * The name and the price as typed, checked by the API's own rules before
 * anything is sent (brief ي-ب §3): `normalizeMenuItemName` and
 * `normalizeMenuPrice`, from `@sufria/shared`. A control character pasted
 * into the name has no text of its own (brief ي-ب text 16): it is the
 * 400 the API would answer — `errors.stepFailed` (decision recorded).
 */
export function checkName(raw: string): Checked {
  const result = normalizeMenuItemName(raw);
  if (result.ok) return { value: result.name };
  switch (result.issue) {
    case "empty":
      return { error: T.errors.nameEmpty };
    case "too_long":
      return { error: T.errors.nameTooLong };
    default:
      return { error: DASHBOARD_UI_AR.errors.stepFailed };
  }
}

export function checkPrice(raw: string): Checked {
  const result = normalizeMenuPrice(raw);
  return result.ok ? { value: result.price } : { error: T.errors.priceInvalid };
}

/**
 * The draft's name, checked, if it differs from the saved one — `null` if
 * not. Untouched is unchanged before any check: a name the setup script
 * saved longer than 40 must not stop a new price.
 */
function changedName(saved: string, typed: string): Checked | null {
  if (typed === saved) return null;
  const checked = checkName(typed);
  return "value" in checked && checked.value === saved ? null : checked;
}

function changedPrice(saved: string, typed: string): Checked | null {
  if (typed === saved) return null;
  const checked = checkPrice(typed);
  return "value" in checked &&
    canonicalPrice(checked.value) === canonicalPrice(saved)
    ? null
    : checked;
}

/**
 * «لم يُحفظ» (decision 2): the row in edit holds something other than what
 * is saved — compared as the API would store it, so 2.50 typed in Arabic-Indic digits over
 * «2.50» is no change, and a name with an extra space neither.
 */
export function isUnsaved(saved: Draft, draft: Draft): boolean {
  return (
    changedName(saved.name, draft.name) !== null ||
    changedPrice(saved.price, draft.price) !== null
  );
}

export type SaveDecision =
  /** No change: the row goes back to normal, and nothing is sent. */
  | { kind: "nothing" }
  /** The texts 16, under their fields; nothing is sent. */
  | { kind: "invalid"; name: string | null; price: string | null }
  /** `PATCH /menu-items/:id` with the changed fields alone. */
  | { kind: "send"; body: UpdateMenuItemRequest };

/**
 * «حفظ» (brief ي-ب §6): only what changed is checked and sent — a name the
 * setup script saved longer than 40 does not stop a new price.
 */
export function saveDecision(saved: Draft, draft: Draft): SaveDecision {
  const name = changedName(saved.name, draft.name);
  const price = changedPrice(saved.price, draft.price);
  if (name === null && price === null) return { kind: "nothing" };
  const nameError = name && "error" in name ? name.error : null;
  const priceError = price && "error" in price ? price.error : null;
  if (nameError !== null || priceError !== null)
    return { kind: "invalid", name: nameError, price: priceError };
  const body: { name?: string; price?: string } = {};
  if (name && "value" in name) body.name = name.value;
  if (price && "value" in price) body.price = price.value;
  return { kind: "send", body };
}

export type AddDecision =
  | { kind: "invalid"; name: string | null; price: string | null }
  | { kind: "send"; body: { categoryId: string; name: string; price: string } };

/** «أضف»: both fields checked, then `POST /menu-items` (brief ي-ب §6). */
export function addDecision(categoryId: string, draft: Draft): AddDecision {
  const name = checkName(draft.name);
  const price = checkPrice(draft.price);
  if ("error" in name || "error" in price)
    return {
      kind: "invalid",
      name: "error" in name ? name.error : null,
      price: "error" in price ? price.error : null,
    };
  return {
    kind: "send",
    body: { categoryId, name: name.value, price: price.value },
  };
}

/**
 * The line an action on **one item** leads to (a `PATCH`): 409
 * `menu_too_long` → text 17 with its length · 409 `item_archived` and a 404
 * → text 18 · anything else → `stepFailed`. `null` for a 401: the gate takes
 * the page to login.
 */
export function itemErrorLine(error: ApiError): string | null {
  if (error.kind === "unauthorized") return null;
  if (error.kind === "menu_conflict")
    return error.code === "menu_too_long"
      ? menuTooLongAr(error.length)
      : T.errors.archived;
  if (error.kind === "http" && error.status === 404) return T.errors.archived;
  return DASHBOARD_UI_AR.errors.stepFailed;
}

/**
 * The line an action on **the menu** leads to — «أضف» and «شغّل الكل»:
 * 409 `menu_too_long` → text 17; anything else, a 404 for a category gone
 * included, `stepFailed`. `null` for a 401.
 */
export function menuErrorLine(error: ApiError): string | null {
  if (error.kind === "unauthorized") return null;
  if (error.kind === "menu_conflict" && error.code === "menu_too_long")
    return menuTooLongAr(error.length);
  return DASHBOARD_UI_AR.errors.stepFailed;
}

/** The list after one item changed: in its place, never moved (brief ي-ب). */
export function replaceItem<T extends { id: string }>(
  items: readonly T[],
  changed: T,
): T[] {
  return items.map((item) => (item.id === changed.id ? changed : item));
}
