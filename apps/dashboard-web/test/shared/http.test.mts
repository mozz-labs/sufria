/**
 * The shared HTTP client (brief G §3, G-2): one refresh per 401, the session
 * forgotten when the refresh cannot cure it, and no exception for a network
 * that does not answer. A recording `fetch` stands in for the network.
 */
import test from "node:test";
import assert from "node:assert/strict";

import type { OrderListResponse } from "@sufria/shared";
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

const listActive = (http: ReturnType<typeof createHttp>) =>
  http.call<OrderListResponse>("/orders?tab=active", {
    method: "GET",
    auth: "restaurant",
  });

test("401: one refresh, then the same request again with the new token", async () => {
  const empty = { orders: [], page: 1, hasMore: false };
  const store = memorySessionStore(SESSION);
  const { calls, fetch } = recorder([
    json(401, { message: "Unauthorized", statusCode: 401 }),
    json(200, { accessToken: "access-2" }),
    json(200, empty),
  ]);
  const http = createHttp({ baseUrl: "http://api.test", store, fetch });

  const res = await listActive(http);

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
  const http = createHttp({ baseUrl: "http://api.test", store, fetch });

  assert.deepEqual(await listActive(http), {
    ok: false,
    error: { kind: "unauthorized" },
  });
  assert.equal(calls.length, 2);
  assert.equal(store.get(), null);
});

test("no answer at all is a network error, not an exception", async () => {
  const http = createHttp({
    baseUrl: "http://api.test",
    store: memorySessionStore(SESSION),
    fetch: (async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch,
  });

  assert.deepEqual(await listActive(http), {
    ok: false,
    error: { kind: "network" },
  });
});
