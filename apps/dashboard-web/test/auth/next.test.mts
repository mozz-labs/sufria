/**
 * `/login?next=` (brief I §2.1, §5 test 8): back to a path of this site, and
 * nowhere else — a login must not send staff to another host.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  AFTER_LOGIN,
  loginPathFor,
  safeNext,
} from "../../features/auth/lib/session.ts";

test("next: a path of this site is where the login goes back to", () => {
  assert.equal(safeNext("/history"), "/history");
  assert.equal(
    safeNext("/orders/f0000000-0000-4000-8000-00000000000a?from=history"),
    "/orders/f0000000-0000-4000-8000-00000000000a?from=history",
  );
  // The guard's own link, read back the way the login form reads it.
  const next = new URL(
    `http://dash.test${loginPathFor("/orders/x?from=history")}`,
  ).searchParams.get("next");
  assert.equal(safeNext(next), "/orders/x?from=history");
});

test("🔴 next: another host, or anything not a path, is /orders", () => {
  assert.equal(AFTER_LOGIN, "/orders");
  for (const next of [
    "//evil.com",
    "//evil.com/orders",
    "https://evil.com",
    "http://evil.com/orders",
    "javascript:alert(1)",
    "evil.com",
    "/\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "",
    null,
    undefined,
  ])
    assert.equal(safeNext(next), "/orders", `next=${JSON.stringify(next)}`);
});

test("next: /login itself is /orders — a logged-in screen does not stay on the form", () => {
  assert.equal(safeNext("/login"), "/orders");
  assert.equal(safeNext("/login?next=%2Fhistory"), "/orders");
});
