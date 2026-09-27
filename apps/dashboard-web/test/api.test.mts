/**
 * The API client (brief G §3, G-2): the two headers, `from` = the status the
 * card showed, and the API's errors turned into kinds the screen switches on.
 * A recording `fetch` stands in for the network; the bodies are the ones
 * brief D §9 documents.
 */
import test from "node:test";
import assert from "node:assert/strict";

import type { OrderListItem } from "@sufria/shared";
import { createApi } from "../lib/api.ts";
import {
  memorySessionStore,
  sessionFromLogin,
  type Session,
} from "../lib/session.ts";

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
  const { calls, fetch } = recorder([
    json(200, { ...ORDER, status: "accepted" }),
  ]);
  const api = createApi({
    baseUrl: "http://api.test/",
    store: memorySessionStore(SESSION),
    fetch,
  });

  const res = await api.changeStatus(ORDER, "accepted");

  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, "PATCH");
  assert.equal(calls[0]!.url, `http://api.test/orders/${ORDER.id}/status`);
  assert.deepEqual(calls[0]!.body, {
    from: "pending_acceptance",
    to: "accepted",
  });
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
  const api = createApi({
    baseUrl: "http://api.test",
    store: memorySessionStore(SESSION),
    fetch,
  });

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
  const api = createApi({
    baseUrl: "http://api.test",
    store: memorySessionStore(SESSION),
    fetch,
  });

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
  const api = createApi({
    baseUrl: "http://api.test",
    store: memorySessionStore(SESSION),
    fetch,
  });

  await api.listOrders("active");
  await api.listOrders("history", 2);

  assert.equal(calls[0]!.url, "http://api.test/orders?tab=active");
  assert.equal(calls[1]!.url, "http://api.test/orders?tab=history&page=2");
});

test("401: one refresh, then the same request again with the new token", async () => {
  const empty = { orders: [], page: 1, hasMore: false };
  const store = memorySessionStore(SESSION);
  const { calls, fetch } = recorder([
    json(401, { message: "Unauthorized", statusCode: 401 }),
    json(200, { accessToken: "access-2" }),
    json(200, empty),
  ]);
  const api = createApi({ baseUrl: "http://api.test", store, fetch });

  const res = await api.listOrders("active");

  assert.deepEqual(res, { ok: true, value: empty });
  assert.equal(calls[1]!.url, "http://api.test/auth/refresh");
  assert.deepEqual(calls[1]!.body, { refreshToken: "refresh-1" });
  assert.equal(calls[2]!.headers["Authorization"], "Bearer access-2");
  assert.equal(store.get()?.accessToken, "access-2");
});

test("401 that the refresh cannot cure: unauthorized, and the session is forgotten", async () => {
  const store = memorySessionStore(SESSION);
  const { calls, fetch } = recorder([
    json(401, { message: "Unauthorized", statusCode: 401 }),
    json(401, { message: "Unauthorized", statusCode: 401 }),
  ]);
  const api = createApi({ baseUrl: "http://api.test", store, fetch });

  assert.deepEqual(await api.listOrders("active"), {
    ok: false,
    error: { kind: "unauthorized" },
  });
  assert.equal(calls.length, 2);
  assert.equal(store.get(), null);
});

test("login: a 401 is unauthorized, with no refresh and no token sent", async () => {
  const { calls, fetch } = recorder([
    json(401, { message: "Unauthorized", statusCode: 401 }),
  ]);
  const api = createApi({
    baseUrl: "http://api.test",
    store: memorySessionStore(),
    fetch,
  });

  assert.deepEqual(
    await api.login({ phoneOrEmail: "x@y.z", password: "nope" }),
    {
      ok: false,
      error: { kind: "unauthorized" },
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.headers["Authorization"], undefined);
});

test("no answer at all is a network error, not an exception", async () => {
  const api = createApi({
    baseUrl: "http://api.test",
    store: memorySessionStore(SESSION),
    fetch: (async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch,
  });

  assert.deepEqual(await api.listOrders("active"), {
    ok: false,
    error: { kind: "network" },
  });
});

test("sessionFromLogin: the first restaurant; none → no session", () => {
  const login = {
    accessToken: "a",
    refreshToken: "r",
    staff: { id: "s", name: "موظف", role: "staff" },
    restaurants: [
      { id: "r1", name: "الفرع الأول", branch: null, role: "staff" },
      { id: "r2", name: "الفرع الثاني", branch: null, role: "staff" },
    ],
  };
  assert.deepEqual(sessionFromLogin(login), {
    accessToken: "a",
    refreshToken: "r",
    restaurantId: "r1",
    restaurantName: "الفرع الأول",
  });
  assert.equal(sessionFromLogin({ ...login, restaurants: [] }), null);
});
