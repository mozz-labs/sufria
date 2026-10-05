/**
 * The orders board (brief G §3 G-4, §4 test 3): the card sends the status it
 * showed as `from`, a 409 status_conflict refreshes with the right line, and
 * the card's text all comes from @sufria/shared.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { DASHBOARD_UI_AR, type OrderListItem } from "@sufria/shared";
import { createOrdersApi } from "../../features/orders/api/orders-api.ts";
import {
  PULSE_MS,
  advance,
  cardView,
  pulses,
  replaceInActive,
} from "../../features/orders/lib/board.ts";
import { createHttp } from "../../shared/api/http.ts";
import { memorySessionStore } from "../../shared/api/session-store.ts";

const NOW = Date.parse("2026-09-27T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const ORDER: OrderListItem = {
  id: "11111111-1111-4111-8111-111111111111",
  orderNumber: 102,
  status: "preparing",
  fulfillmentType: "delivery",
  total: "13.50",
  itemCount: 2,
  createdAt: ago(6 * 60_000),
  customer: { name: null, phone: "+962790004321" },
  items: [
    { name: "شاورما", quantity: 2 },
    { name: "بطاطا", quantity: 1 },
  ],
  statusChangedAt: ago(30_000),
  cancellationReason: null,
};

function apiReplying(status: number, body: unknown) {
  const sent: unknown[] = [];
  const api = createOrdersApi(
    createHttp({
      baseUrl: "http://api.test",
      store: memorySessionStore({
        accessToken: "a",
        refreshToken: "r",
        restaurantId: "rid",
        restaurantName: "مطعم",
      }),
      fetch: (async (_url: string, init: RequestInit = {}) => {
        sent.push(JSON.parse(init.body as string));
        return new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch,
    }),
  );
  return { api, sent };
}

test("cardView: the brief's card, right to left, all from shared", () => {
  assert.deepEqual(cardView(ORDER, "active", "JOD", NOW), {
    number: "#102",
    customer: "•••• 4321",
    details: "توصيل · شاورما ×2 · بطاطا",
    reason: null,
    badge: "قيد التحضير",
    amount: "13.50 د.أ",
    since: "منذ 6 دقائق",
    pulse: true,
    action: { to: "ready", label: "سلّمناه للسائق" },
  });
});

test("cardView: history has no button, and a cancelled order shows its reason", () => {
  const cancelled = {
    ...ORDER,
    status: "cancelled" as const,
    cancellationReason: "نفد الخبز",
  };
  const view = cardView(cancelled, "history", "ILS", NOW);
  assert.equal(view.action, null);
  assert.equal(view.reason, "نفد الخبز");
  assert.equal(view.amount, "13.50 شيكل");
  // The same order in the active tab never shows a reason line.
  assert.equal(cardView(cancelled, "active", "ILS", NOW).reason, null);
});

test("pulse: only for a status changed in the last 60 seconds", () => {
  assert.equal(pulses({ ...ORDER, statusChangedAt: ago(0) }, NOW), true);
  assert.equal(
    pulses({ ...ORDER, statusChangedAt: ago(PULSE_MS - 1) }, NOW),
    true,
  );
  assert.equal(
    pulses({ ...ORDER, statusChangedAt: ago(PULSE_MS) }, NOW),
    false,
  );
  // Stamped after the screen's last tick — its own button's reply, or a
  // server clock ahead of the browser's: it just changed.
  assert.equal(pulses({ ...ORDER, statusChangedAt: ago(-4_000) }, NOW), true);
  // Created long ago but moved just now: the change is what counts.
  assert.equal(
    pulses(
      { ...ORDER, createdAt: ago(3_600_000), statusChangedAt: ago(5_000) },
      NOW,
    ),
    true,
  );
});

test("🔴 the button sends from = the status the card showed", async () => {
  const { api, sent } = apiReplying(200, { ...ORDER, status: "ready" });
  const view = cardView(ORDER, "active", "JOD", NOW);

  const outcome = await advance(api, ORDER, view.action!);

  assert.deepEqual(sent, [{ from: "preparing", to: "ready" }]);
  assert.equal(outcome.kind, "changed");
});

test("🔴 409 status_conflict: refresh the list, and the line under the card", async () => {
  const { api } = apiReplying(409, {
    statusCode: 409,
    error: "Conflict",
    code: "status_conflict",
    message: "the order is ready, not preparing",
    currentStatus: "ready",
  });

  assert.deepEqual(await advance(api, ORDER, { to: "ready", label: "جاهز" }), {
    kind: "refresh",
    line: "تغيّرت حالة الطلب من جهاز آخر.",
  });
});

test("any other 409: the other line, and no refresh", async () => {
  const { api } = apiReplying(409, {
    statusCode: 409,
    error: "Conflict",
    code: "payment_not_settled",
    message: "only a cash order, or a paid one, can be accepted",
  });

  assert.deepEqual(
    await advance(
      api,
      { ...ORDER, status: "pending_acceptance" },
      {
        to: "accepted",
        label: DASHBOARD_UI_AR.actions.accept,
      },
    ),
    { kind: "failed", line: "لا يمكن تنفيذ هذه الخطوة الآن." },
  );
});

test("replaceInActive: in place, or gone once completed", () => {
  const other = { ...ORDER, id: "22222222-2222-4222-8222-222222222222" };
  const ready = { ...ORDER, status: "ready" as const };
  assert.deepEqual(replaceInActive([ORDER, other], ready), [ready, other]);
  assert.deepEqual(
    replaceInActive([ORDER, other], { ...ORDER, status: "completed" }),
    [other],
  );
});
