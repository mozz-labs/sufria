/**
 * د-2 — تبويبا لوحة الطلبات (بريف د §2.5).
 *
 * 🔴 كل حالة بتبويب واحد بالضبط. حالة بلا تبويب = طلب ما بيظهر للموظف
 *    بأي شاشة، بلا أي خطأ. حالة بتبويبين = طلب مكرّر.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { ORDER_STATUSES, ORDER_TAB_STATUSES, ORDER_TABS } from "@sufria/shared";

test("the two tabs are exactly the statuses of brief §2.5", () => {
  assert.deepEqual(ORDER_TABS, ["active", "history"]);
  assert.deepEqual(ORDER_TAB_STATUSES.active, [
    "pending_acceptance",
    "accepted",
    "preparing",
    "ready",
  ]);
  assert.deepEqual(ORDER_TAB_STATUSES.history, [
    "completed",
    "cancelled",
    "expired",
  ]);
});

test("every order status lives in exactly one tab", () => {
  const placed = ORDER_TABS.flatMap((tab) => ORDER_TAB_STATUSES[tab]);
  assert.equal(new Set(placed).size, placed.length, "a status in two tabs");
  assert.deepEqual([...placed].sort(), [...ORDER_STATUSES].sort());
});
