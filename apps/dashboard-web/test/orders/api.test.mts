/**
 * The orders calls (brief G §3, G-2): the two headers, `from` = the status the
 * card showed, and the API's 409s turned into kinds the screen switches on.
 * A recording `fetch` stands in for the network; the bodies are the ones
 * brief D §9 documents.
 */
import test from "node:test";
import assert from "node:assert/strict";

import type { OrderListItem } from "@sufria/shared";
import { createOrdersApi } from "../../features/orders/api/orders-api.ts";
import { createHttp } from "../../shared/api/http.ts";
import {
  memorySessionStore,
  type Session,
} from "../../shared/api/session-store.ts";

const SESSION: Session = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  restaurantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  restaurantName: "مطعم",
};

type Call = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
};

function recorder(replies: Array<(call: Call) => Response>) {
  const calls: Call[] = [];
  const fetch = (async (input: string, init: RequestInit = {}) => {
    const call: Call = {
      url: input,
      method: init.method ?? "GET",
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    const reply = replies.shift();
    if (!reply) throw new Error(`unexpected call ${call.method} ${call.url}`);
    return reply(call);
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

const json = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const ordersApiOn = (baseUrl: string, fetch: typeof globalThis.fetch) =>
  createOrdersApi(
    createHttp({ baseUrl, store: memorySessionStore(SESSION), fetch }),
  );

const ORDER: OrderListItem = {
  id: "f0000000-0000-4000-8000-00000000000a",
  orderNumber: 101,
  status: "pending_acceptance",
  fulfillmentType: "pickup",
  total: "5.00",
  itemCount: 1,
  createdAt: "2026-09-27T09:00:00.000Z",
  customer: { name: null, phone: "+962790000001" },
  items: [{ name: "شاورما دجاج", quantity: 2 }],
  statusChangedAt: "2026-09-27T09:00:00.000Z",
  cancellationReason: null,
};

test("changeStatus: from is the status the card showed, with token and restaurant headers", async () => {
  const { calls, fetch } = recorder([json(200, { ...ORDER, status: "ready" })]);
  const api = ordersApiOn("http://api.test/", fetch);

  // A card showing `preparing`: not the first status, so a hard-coded
  // `from` cannot pass by accident.
  const res = await api.changeStatus(
    { ...ORDER, status: "preparing" },
    "ready",
  );

  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, "PATCH");
  assert.equal(calls[0]!.url, `http://api.test/orders/${ORDER.id}/status`);
  assert.deepEqual(calls[0]!.body, { from: "preparing", to: "ready" });
  assert.equal(calls[0]!.headers["Authorization"], "Bearer access-1");
  assert.equal(calls[0]!.headers["x-restaurant-id"], SESSION.restaurantId);
});

test("changeStatus: 409 status_conflict carries the real status", async () => {
  const { fetch } = recorder([
    json(409, {
      statusCode: 409,
      error: "Conflict",
      code: "status_conflict",
      message: "the order is preparing, not pending_acceptance",
      currentStatus: "preparing",
    }),
  ]);
  const api = ordersApiOn("http://api.test", fetch);

  assert.deepEqual(await api.changeStatus(ORDER, "accepted"), {
    ok: false,
    error: { kind: "status_conflict", currentStatus: "preparing" },
  });
});

test("changeStatus: any other 409 is a conflict by its code", async () => {
  const { fetch } = recorder([
    json(409, {
      statusCode: 409,
      error: "Conflict",
      code: "payment_not_settled",
      message: "only a cash order, or a paid one, can be accepted",
    }),
  ]);
  const api = ordersApiOn("http://api.test", fetch);

  assert.deepEqual(await api.changeStatus(ORDER, "accepted"), {
    ok: false,
    error: { kind: "conflict", code: "payment_not_settled" },
  });
});

test("listOrders: active has no page, history carries it", async () => {
  const empty = { orders: [], page: 1, hasMore: false };
  const { calls, fetch } = recorder([
    json(200, empty),
    json(200, { ...empty, page: 2 }),
  ]);
  const api = ordersApiOn("http://api.test", fetch);

  await api.listOrders("active");
  await api.listOrders("history", 2);

  assert.equal(calls[0]!.url, "http://api.test/orders?tab=active");
  assert.equal(calls[1]!.url, "http://api.test/orders?tab=history&page=2");
});
