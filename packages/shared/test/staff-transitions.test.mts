/**
 * د-4 — انتقالات الموظف من اللوحة (بريف د §2.6 و§8.6).
 *
 * 🔴 `canTransition` وحدها ما بتكفي للوحة: فيها `ready ← expired`، وهاي
 *    للنظام وحده. `STAFF_TRANSITIONS` جزء منها، وهالملف بيفرض الجزئية.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOWED_TRANSITIONS,
  ORDER_STATUSES,
  STAFF_TARGET_STATUSES,
  STAFF_TRANSITIONS,
  canStaffTransition,
  type OrderStatus,
} from "@sufria/shared";

const pairs = (table: Record<OrderStatus, readonly OrderStatus[]>): string[] =>
  ORDER_STATUSES.flatMap((from) => table[from].map((to) => `${from} → ${to}`));

test("STAFF_TRANSITIONS is the table of brief §2.6, verbatim", () => {
  assert.deepEqual(STAFF_TRANSITIONS, {
    pending_acceptance: ["accepted", "cancelled"],
    accepted: ["preparing", "cancelled"],
    preparing: ["ready", "completed", "cancelled"],
    ready: ["completed", "cancelled"],
    completed: [],
    cancelled: [],
    expired: [],
  });
});

test("every staff transition is an allowed transition", () => {
  for (const pair of pairs(STAFF_TRANSITIONS)) {
    assert.ok(pairs(ALLOWED_TRANSITIONS).includes(pair), pair);
  }
});

test("the only allowed transition staff cannot take is ready → expired", () => {
  const systemOnly = pairs(ALLOWED_TRANSITIONS).filter(
    (pair) => !pairs(STAFF_TRANSITIONS).includes(pair),
  );
  assert.deepEqual(systemOnly, ["ready → expired"]);
});

test("pending_acceptance and expired are never a staff destination", () => {
  assert.deepEqual(
    [...STAFF_TARGET_STATUSES].sort(),
    ORDER_STATUSES.filter(
      (s) => s !== "pending_acceptance" && s !== "expired",
    ).sort(),
  );
  // Every target is reachable from somewhere, and nothing else is.
  const destinations = new Set(
    ORDER_STATUSES.flatMap((s) => STAFF_TRANSITIONS[s]),
  );
  assert.deepEqual([...destinations].sort(), [...STAFF_TARGET_STATUSES].sort());
});

test("canStaffTransition answers from the table and nothing else", () => {
  for (const from of ORDER_STATUSES) {
    for (const to of STAFF_TARGET_STATUSES) {
      assert.equal(
        canStaffTransition(from, to),
        STAFF_TRANSITIONS[from].includes(to),
        `${from} → ${to}`,
      );
    }
  }
  assert.equal(canStaffTransition("preparing", "completed"), true);
  assert.equal(canStaffTransition("completed", "cancelled"), false);
});
