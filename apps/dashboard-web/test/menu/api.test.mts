/**
 * The menu's calls (brief ي-ب §4): the routes of brief D §9.10 with the two
 * headers, the bodies as sent, and the menu's 409s turned into a kind with
 * its `code` — `length` with `menu_too_long` — while the orders' 409s stay
 * exactly as they were. A recording `fetch` stands in for the network.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createMenuApi } from "../../features/menu/api/menu-api.ts";
import { createOrdersPauseApi } from "../../features/menu/api/orders-pause-api.ts";
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
const ITEM = "e0000000-0000-4000-8000-00000000000a";

type Call = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
};

function recorder(replies: Array<() => Response>) {
  const calls: Call[] = [];
  const fetch = (async (input: string, init: RequestInit = {}) => {
    calls.push({
      url: input,
      method: init.method ?? "GET",
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    const reply = replies.shift();
    if (!reply) throw new Error(`unexpected call ${input}`);
    return reply();
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

const json = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const httpOn = (fetch: typeof globalThis.fetch) =>
  createHttp({
    baseUrl: "http://api.test",
    store: memorySessionStore(SESSION),
    fetch,
  });

const TOO_LONG = {
  statusCode: 409,
  error: "Conflict",
  code: "menu_too_long",
  message: "the first message would be 4123 characters, over WhatsApp's 4096",
  length: 4123,
  limit: 4096,
};
const ARCHIVED = {
  statusCode: 409,
  error: "Conflict",
  code: "item_archived",
  message: "the item is archived: only archived: false applies to it",
};

test("the menu's routes, methods and bodies — each with the token and the restaurant", async () => {
  const { calls, fetch } = recorder(Array(7).fill(json(200, {})));
  const menu = createMenuApi(httpOn(fetch));
  const pause = createOrdersPauseApi(httpOn(fetch));

  await menu.listItems();
  await menu.listArchived();
  await menu.listCategories();
  await menu.createItem({ categoryId: "c", name: "فتوش", price: "2.25" });
  await menu.updateItem(ITEM, { price: "3.00" });
  await menu.enableAll();
  await pause.setPaused(true);

  assert.deepEqual(
    calls.map((c) => [c.method, c.url, c.body]),
    [
      ["GET", "http://api.test/menu-items", undefined],
      ["GET", "http://api.test/menu-items?archived=true", undefined],
      ["GET", "http://api.test/menu-categories", undefined],
      [
        "POST",
        "http://api.test/menu-items",
        { categoryId: "c", name: "فتوش", price: "2.25" },
      ],
      ["PATCH", `http://api.test/menu-items/${ITEM}`, { price: "3.00" }],
      ["POST", "http://api.test/menu-items/enable-all", undefined],
      ["PATCH", "http://api.test/restaurant/orders-pause", { paused: true }],
    ],
  );
  for (const c of calls) {
    assert.equal(c.headers["Authorization"], "Bearer access-1");
    assert.equal(c.headers["x-restaurant-id"], SESSION.restaurantId);
  }
});

test("🔴 409 menu_too_long: the menu's kind, with its code and the length it would have had", async () => {
  const { fetch } = recorder([json(409, TOO_LONG)]);
  assert.deepEqual(
    await createMenuApi(httpOn(fetch)).updateItem(ITEM, { isAvailable: true }),
    {
      ok: false,
      error: {
        kind: "menu_conflict",
        code: "menu_too_long",
        length: 4123,
        limit: 4096,
      },
    },
  );
});

test("🔴 409 item_archived: the menu's kind, with its code", async () => {
  const { fetch } = recorder([json(409, ARCHIVED)]);
  assert.deepEqual(
    await createMenuApi(httpOn(fetch)).updateItem(ITEM, { name: "فتوش" }),
    { ok: false, error: { kind: "menu_conflict", code: "item_archived" } },
  );
});

test("🔴 the orders' 409s are as they were, on the same client", async () => {
  const order = {
    id: "f0000000-0000-4000-8000-00000000000a",
    status: "pending_acceptance" as const,
  };
  const { fetch } = recorder([
    json(409, {
      statusCode: 409,
      error: "Conflict",
      code: "status_conflict",
      message: "x",
      currentStatus: "preparing",
    }),
    json(409, {
      statusCode: 409,
      error: "Conflict",
      code: "payment_not_settled",
      message: "x",
    }),
    json(409, {
      statusCode: 409,
      error: "Conflict",
      code: "transition_not_allowed",
      message: "x",
    }),
    json(409, { statusCode: 409, error: "Conflict", message: "no code" }),
  ]);
  const orders = createOrdersApi(httpOn(fetch));
  assert.deepEqual(await orders.changeStatus(order, "accepted"), {
    ok: false,
    error: { kind: "status_conflict", currentStatus: "preparing" },
  });
  assert.deepEqual(await orders.changeStatus(order, "accepted"), {
    ok: false,
    error: { kind: "conflict", code: "payment_not_settled" },
  });
  assert.deepEqual(await orders.changeStatus(order, "accepted"), {
    ok: false,
    error: { kind: "conflict", code: "transition_not_allowed" },
  });
  assert.deepEqual(await orders.changeStatus(order, "accepted"), {
    ok: false,
    error: { kind: "http", status: 409 },
  });
});
