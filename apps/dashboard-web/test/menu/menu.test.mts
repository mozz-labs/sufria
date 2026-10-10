/**
 * The menu screen's decisions (brief ي-ب §6, §10): what a row shows, what
 * is checked before sending and with which text, when «لم يُحفظ» shows,
 * what «حفظ» sends, and the line each answer leads to. Pure, as the orders'
 * `board.ts` and `details.ts` are.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  DASHBOARD_UI_AR,
  MENU_ITEM_NAME_MAX,
  type MenuItemListItem,
} from "@sufria/shared";
import {
  addDecision,
  byCategory,
  checkName,
  checkPrice,
  isUnsaved,
  itemErrorLine,
  menuErrorLine,
  offCount,
  replaceItem,
  rowView,
  saveDecision,
} from "../../features/menu/lib/menu.ts";

const T = DASHBOARD_UI_AR.menu;

/**
 * A number as a staff keyboard types it — Arabic-Indic digits and `٫`
 * (`arabic`), or Extended Arabic-Indic (`persian`) — built from the code
 * points: check:numerals holds this file to Western digits.
 */
const arabic = (n: string) =>
  n
    .replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + Number(d)))
    .replace(".", "\u066b");
const persian = (n: string) =>
  n.replace(/[0-9]/g, (d) => String.fromCharCode(0x06f0 + Number(d)));

const item = (
  id: string,
  over: Partial<MenuItemListItem> = {},
): MenuItemListItem => ({
  id,
  name: "شاورما دجاج",
  price: "2.50",
  isAvailable: true,
  categoryId: "c1",
  categoryName: "شاورما",
  ...over,
});

test("🔴 a row: the available one offers «أطفئ», not «شغّل»; the switched-off one the other way round", () => {
  const on = rowView(item("a"), "JOD");
  assert.equal(on.toggle.label, T.turnOff);
  assert.notEqual(on.toggle.label, T.turnOn);
  assert.equal(on.toggle.isAvailable, false);
  assert.equal(on.status, "متاح");
  const off = rowView(item("a", { isAvailable: false }), "JOD");
  assert.equal(off.toggle.label, T.turnOn);
  assert.notEqual(off.toggle.label, T.turnOff);
  assert.equal(off.toggle.isAvailable, true);
  // The state in a word, never by colour alone.
  assert.equal(off.status, "مطفأ");
  // The price as the API gave it, with the restaurant's currency.
  assert.equal(on.amount, "2.50 د.أ");
});

test("the menu under its headings, in the API's order; a change keeps the item in its place", () => {
  const list = [
    item("a"),
    item("b", { isAvailable: false }),
    item("c", { categoryId: "c2", categoryName: "مشروبات" }),
  ];
  assert.deepEqual(
    byCategory(list).map((g) => [g.name, g.items.map((i) => i.id)]),
    [
      ["شاورما", ["a", "b"]],
      ["مشروبات", ["c"]],
    ],
  );
  const switchedOff = replaceItem(list, item("a", { isAvailable: false }));
  assert.deepEqual(
    switchedOff.map((i) => i.id),
    ["a", "b", "c"],
  );
  assert.equal(offCount(list), 1);
  assert.equal(offCount(switchedOff), 2);
});

test("🔴 before sending: 2.50 and 2.5 in Arabic digits pass; 0, 2,50 and 2.505 are refused with text 16", () => {
  assert.deepEqual(checkPrice(arabic("2.50")), { value: "2.50" });
  assert.deepEqual(checkPrice(persian("2.5")), { value: "2.5" });
  for (const refused of ["0", "2,50", "2.505", "", arabic("0")])
    assert.deepEqual(
      checkPrice(refused),
      { error: "اكتب سعرا صحيحا، مثل 2.50." },
      refused,
    );
});

test("🔴 a name of 40 passes and 41 does not — counted as WhatsApp counts", () => {
  const forty = "ش".repeat(MENU_ITEM_NAME_MAX);
  assert.deepEqual(checkName(forty), { value: forty });
  assert.deepEqual(checkName(`${forty}ش`), {
    error: "الاسم أطول من 40 حرفا.",
  });
  // An emoji is one character to WhatsApp, two to `.length`.
  const emoji = `${"ش".repeat(MENU_ITEM_NAME_MAX - 1)}🌯`;
  assert.deepEqual(checkName(emoji), { value: emoji });
  assert.deepEqual(checkName("   "), { error: "اكتب اسم الصنف." });
  // The API's normalisation: trimmed, one space, Western digits.
  assert.deepEqual(checkName(`  وجبة   ${arabic("2")} `), { value: "وجبة 2" });
  // A control character has no text of its own: the 400 it would be.
  assert.deepEqual(checkName("شاورما\tدجاج"), {
    error: DASHBOARD_UI_AR.errors.stepFailed,
  });
});

const SAVED = { name: "شاورما دجاج", price: "2.50" };

test("🔴 «لم يُحفظ» only when the fields differ from what is saved — as the API would store them", () => {
  assert.equal(isUnsaved(SAVED, { ...SAVED }), false);
  assert.equal(isUnsaved(SAVED, { ...SAVED, price: arabic("2.50") }), false);
  assert.equal(isUnsaved(SAVED, { ...SAVED, price: "2.5" }), false);
  assert.equal(isUnsaved(SAVED, { ...SAVED, name: " شاورما  دجاج " }), false);
  assert.equal(isUnsaved(SAVED, { ...SAVED, price: "2.75" }), true);
  assert.equal(isUnsaved(SAVED, { ...SAVED, name: "شاورما لحمة" }), true);
  // Something that is not a price is not what is saved.
  assert.equal(isUnsaved(SAVED, { ...SAVED, price: "2,50" }), true);
});

test("🔴 «حفظ» sends the changed field alone — and nothing without a change", () => {
  assert.deepEqual(saveDecision(SAVED, { ...SAVED }), { kind: "nothing" });
  assert.deepEqual(saveDecision(SAVED, { ...SAVED, price: arabic("3.75") }), {
    kind: "send",
    body: { price: "3.75" },
  });
  assert.deepEqual(saveDecision(SAVED, { ...SAVED, name: "شاورما لحمة" }), {
    kind: "send",
    body: { name: "شاورما لحمة" },
  });
  assert.deepEqual(saveDecision(SAVED, { name: "شاورما لحمة", price: "3" }), {
    kind: "send",
    body: { name: "شاورما لحمة", price: "3" },
  });
  // A field in error stops the save, with its text; nothing is sent.
  assert.deepEqual(saveDecision(SAVED, { ...SAVED, price: "0" }), {
    kind: "invalid",
    name: null,
    price: T.errors.priceInvalid,
  });
  // A saved name longer than 40 (the setup script does not check) does not
  // stop a new price: only what changed is checked.
  const long = { name: "ش".repeat(45), price: "2.50" };
  assert.deepEqual(saveDecision(long, { ...long, price: "3.00" }), {
    kind: "send",
    body: { price: "3.00" },
  });
});

test("«أضف»: both fields checked, then the category, the name and the price as the API stores them", () => {
  assert.deepEqual(addDecision("c1", { name: "", price: "x" }), {
    kind: "invalid",
    name: T.errors.nameEmpty,
    price: T.errors.priceInvalid,
  });
  assert.deepEqual(
    addDecision("c1", { name: " فتوش ", price: arabic("2.25") }),
    {
      kind: "send",
      body: { categoryId: "c1", name: "فتوش", price: "2.25" },
    },
  );
});

test("🔴 409 menu_too_long is text 17 with its length; item_archived and a 404 on an item are text 18", () => {
  const tooLong = {
    kind: "menu_conflict",
    code: "menu_too_long",
    length: 4123,
    limit: 4096,
  } as const;
  const text17 =
    "لن يتسع المنيو في رسالة واتساب واحدة: سيصبح 4123 حرفا والحد 4096. اختصر اسما أو أزل صنفا.";
  assert.equal(itemErrorLine(tooLong), text17);
  assert.equal(menuErrorLine(tooLong), text17);
  const text18 = "أُزيل هذا الصنف من جهاز آخر.";
  assert.equal(
    itemErrorLine({ kind: "menu_conflict", code: "item_archived" }),
    text18,
  );
  assert.equal(itemErrorLine({ kind: "http", status: 404 }), text18);
  // Anything else on an action: stepFailed. A 404 on «أضف» is a category
  // gone, not an item: stepFailed too.
  const failed = DASHBOARD_UI_AR.errors.stepFailed;
  assert.equal(itemErrorLine({ kind: "http", status: 400 }), failed);
  assert.equal(itemErrorLine({ kind: "http", status: 500 }), failed);
  assert.equal(itemErrorLine({ kind: "network" }), failed);
  assert.equal(menuErrorLine({ kind: "http", status: 404 }), failed);
  // 401: no line — the gate takes the page to login.
  assert.equal(itemErrorLine({ kind: "unauthorized" }), null);
  assert.equal(menuErrorLine({ kind: "unauthorized" }), null);
});
