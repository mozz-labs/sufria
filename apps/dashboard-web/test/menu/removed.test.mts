/**
 * «المُزالة» (brief ي-ب §7): the archived items, the most recent first, as
 * the API returns them; a row's name, price and category, and «إرجاع» —
 * `{ archived: false }` — after which the item leaves the list and line 14
 * says where it went. Pure where it can be, the TSX read where it cannot.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { restoredLineAr, type ArchivedMenuItem } from "@sufria/shared";
import { removedRowView } from "../../features/menu/lib/menu.ts";

const read = (path: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../${path}`, import.meta.url)),
    "utf8",
  );
const removed = read("features/menu/components/removed-items.tsx");

const ITEM: ArchivedMenuItem = {
  id: "e0000000-0000-4000-8000-00000000000a",
  name: "فتوش",
  price: "2.25",
  isAvailable: false,
  categoryId: "c3",
  categoryName: "سلطات",
  archivedAt: "2026-10-10T10:15:00.000Z",
};

test("a removed item's row: its name, its price with the currency, its category", () => {
  assert.deepEqual(removedRowView(ITEM, "ILS"), {
    name: "فتوش",
    amount: "2.25 شيكل",
    category: "سلطات",
  });
});

test("🔴 «إرجاع» sends archived: false alone; the item leaves the list, and line 14 names it", () => {
  const restore = removed.slice(
    removed.indexOf("async function restore()"),
    removed.indexOf("return (", removed.indexOf("async function restore()")),
  );
  assert.match(
    restore,
    /menuApi\.updateItem\(item\.id, \{ archived: false \}\)/,
  );
  assert.match(restore, /if \(res\.ok\) onRestored\(item\);/);
  assert.match(
    removed,
    /drop\(item\.id\);\s*setRestored\(restoredLineAr\(item\.name\)\);/,
  );
  assert.match(removed, /role="status" aria-live="polite"/);
  assert.equal(
    restoredLineAr(ITEM.name),
    "رجع فتوش إلى «الأصناف» مطفأ. شغّله من هناك ليظهر للزبائن.",
  );
  assert.match(removed, /aria-busy=\{busy\}/);
});

test("«المُزالة»: the API's list, in its order; its tab marked; its empty text", () => {
  assert.match(
    read("features/menu/hooks/use-removed.ts"),
    /menuApi\.listArchived\(\)/,
  );
  assert.doesNotMatch(removed, /\.sort\(/);
  assert.match(removed, /<MenuTabs current="removed" \/>/);
  assert.match(removed, /\{T\.menu\.empty\.removed\}/);
});
