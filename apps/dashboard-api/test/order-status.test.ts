/**
 * د-4 — `PATCH /orders/:id/status` (بريف د §3.3، مع §8.1 و§8.2 و§8.6 و§8.7).
 *
 * Same harness as the D-2 and D-3 suites: the real AppModule over real HTTP,
 * into Postgres as `sufria_dashboard` with RLS live, and fixtures written — and
 * audited — through MIGRATION_DATABASE_URL.
 *
 * 🔴 Three tests are only worth something because of how they are built:
 *
 *   - "two requests at the same moment" runs two instances of the API against
 *     one database. With PG_POOL_MAX=1 one instance cannot hold two
 *     transactions at once, so two requests to it would run one after the
 *     other and never meet in Postgres. The first request is paused *after*
 *     its UPDATE — a SHARE lock on order_status_history stops its history
 *     insert while it holds the order's row lock — and pg_blocking_pids proves
 *     the second one really waited on it.
 *
 *   - "a failure forced at the history insert" fails the last step, not an
 *     early one. The trigger raises only once this transaction already sees
 *     the order at its new status, and counts itself on a sequence, which a
 *     rollback does not undo: a 500 from anything earlier cannot pass it.
 *
 *   - restaurant B's online order from the seed is moved to `preparing` for
 *     one test and put back exactly as it was: other suites read the seed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { Pool, type PoolClient } from "pg";
import {
  ORDER_STATUSES,
  STAFF_TRANSITIONS,
  type OrderListResponse,
  type OrderStatus,
  type OrderStatusConflictCode,
  type PaymentStatus,
  type UpdateOrderStatusResponse,
} from "@sufria/shared";

import { AppModule } from "../src/app.module.js";

const RESTAURANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RESTAURANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SEED_ORDER_A = "f0000000-0000-4000-8000-00000000000a";
const SEED_ORDER_B = "f0000000-0000-4000-8000-00000000000b";
const STAFF_BOTH = "50000000-0000-4000-8000-000000000001";
/** Well-formed, and belongs to no order anywhere. */
const NO_SUCH_ORDER = "f0000000-0000-4000-8000-0000000000ff";
const CUSTOMER_PHONE = "+962791234567";

const RUN = `d4-${process.pid}-${Date.now()}`;
const BASE = Date.parse("2026-01-01T08:00:00.000Z");
const at = (minutes: number): string =>
  new Date(BASE + minutes * 60_000).toISOString();

const NOT_FOUND_BODY = { message: "Not Found", statusCode: 404 };

let app: INestApplication;
let baseUrl: string;
let jwt: JwtService;
let audit: Pool;

const createdRestaurants: string[] = [];
const createdStaff: string[] = [];

let staffOnlyB = "";
let staffTest = "";
let staffColleague = "";
/** The restaurant this suite creates; every order below lives in it. */
let shop = "";
let customerId = "";
let nextNumber = 101;
let minute = 0;

type Fixture = {
  id: string;
  orderNumber: number;
  fulfillment: "pickup" | "delivery";
  total: string;
  createdAt: string;
};

type OrderState = {
  status: OrderStatus;
  payment_status: PaymentStatus;
  notified: boolean;
  ready_at: string | null;
  updated_at: string;
  cancelled_by: string | null;
  cancellation_reason: string | null;
};

type HistoryRow = {
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  actor: string;
  actor_staff_id: string | null;
  reason: string | null;
  changed_at: string;
};

/** One instance of the API on a free port — the real AppModule, guards and pipes included. */
async function startApi(): Promise<{ app: INestApplication; url: string }> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const instance = moduleRef.createNestApplication();
  await instance.init();
  await instance.listen(0);
  const url = (await instance.getUrl()).replace("[::1]", "127.0.0.1");
  return { app: instance, url };
}

async function createStaff(label: string): Promise<string> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO staff_accounts (phone_or_email, password_hash, name)
     VALUES ($1, 'x', $2) RETURNING id`,
    [`${label}-${RUN}@sufria.test`, `موظف ${label}`],
  );
  const id = rows[0]!.id;
  createdStaff.push(id);
  return id;
}

async function addMember(staffId: string, restaurant: string): Promise<void> {
  await audit.query(
    `INSERT INTO restaurant_staff (staff_account_id, restaurant_id, role, is_active)
     VALUES ($1, $2, 'staff', true)`,
    [staffId, restaurant],
  );
}

/**
 * One order in this suite's restaurant, shaped to satisfy every CHECK on
 * `orders`, with two lines and its creation row in the history.
 *
 * `notified = true` and an `updated_at` in the past on purpose: a transition
 * that resets the one and stamps the other would be invisible if they already
 * held those values.
 */
async function createOrder(spec: {
  status: OrderStatus;
  fulfillment?: "pickup" | "delivery";
  paymentMethod?: "cash" | "online";
  paymentStatus?: PaymentStatus;
}): Promise<Fixture> {
  const fulfillment = spec.fulfillment ?? "pickup";
  const method = spec.paymentMethod ?? "cash";
  const paymentStatus =
    spec.paymentStatus ??
    (method === "online"
      ? "pending_online"
      : spec.status === "completed"
        ? "collected"
        : "pending_cash");
  const fee = fulfillment === "delivery" ? "1.50" : "0";
  const createdAt = at(minute++);
  const orderNumber = nextNumber++;
  const { rows } = await audit.query<{ id: string; total: string }>(
    `INSERT INTO orders (restaurant_id, customer_id, order_number, fulfillment_type,
                         payment_method, status, payment_status, cancelled_by,
                         notified, subtotal, delivery_fee, total, delivery_address,
                         ready_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4::fulfillment_type, $5::payment_method, $6::order_status,
             $7::payment_status,
             CASE WHEN $6 = 'cancelled' THEN 'restaurant'::cancelled_by END,
             true, 5.00, $8::numeric, 5.00 + $8::numeric,
             CASE WHEN $4 = 'delivery' THEN 'شارع الجامعة، بناية 12' END,
             CASE WHEN $6 = 'ready' THEN $9::timestamptz END,
             $9::timestamptz, $9::timestamptz)
     RETURNING id, total::text AS total`,
    [
      shop,
      customerId,
      orderNumber,
      fulfillment,
      method,
      spec.status,
      paymentStatus,
      fee,
      createdAt,
    ],
  );
  const { id, total } = rows[0]!;
  // Two lines, so itemCount is a count and not a constant.
  for (const name of ["شاورما دجاج", "حمص"]) {
    await audit.query(
      `INSERT INTO order_items (order_id, restaurant_id, item_name_snapshot,
                                unit_price_snapshot, quantity)
       VALUES ($1, $2, $3, 2.50, 1)`,
      [id, shop, name],
    );
  }
  await audit.query(
    `INSERT INTO order_status_history (order_id, restaurant_id, from_status,
                                       to_status, actor, changed_at)
     VALUES ($1, $2, NULL, 'pending_acceptance', 'customer', $3::timestamptz)`,
    [id, shop, createdAt],
  );
  return { id, orderNumber, fulfillment, total, createdAt };
}

/** The §3.1 list item this fixture should come back as. */
const itemOf = (
  o: Fixture,
  status: OrderStatus,
): UpdateOrderStatusResponse => ({
  id: o.id,
  orderNumber: o.orderNumber,
  status,
  fulfillmentType: o.fulfillment,
  total: o.total,
  itemCount: 2,
  createdAt: o.createdAt,
  customer: { name: null, phone: CUSTOMER_PHONE },
});

/** The order as the database holds it — asked above RLS. Timestamps as text, to the microsecond. */
async function stateOf(id: string): Promise<OrderState> {
  const { rows } = await audit.query<OrderState>(
    `SELECT status, payment_status, notified,
            ready_at::text AS ready_at, updated_at::text AS updated_at,
            cancelled_by, cancellation_reason
       FROM orders WHERE id = $1`,
    [id],
  );
  return rows[0]!;
}

async function historyOf(id: string): Promise<HistoryRow[]> {
  const { rows } = await audit.query<HistoryRow>(
    `SELECT from_status, to_status, actor, actor_staff_id, reason,
            changed_at::text AS changed_at
       FROM order_status_history WHERE order_id = $1 ORDER BY id`,
    [id],
  );
  return rows;
}

const staffRows = (history: HistoryRow[]): HistoryRow[] =>
  history.filter((h) => h.actor === "staff");

const token = (staffAccountId: string): string =>
  jwt.sign({ sub: staffAccountId, typ: "access" });

async function patchStatus(
  id: string,
  body: unknown,
  opts: { staff?: string; restaurantId?: string; url?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (opts.staff !== undefined)
    headers["authorization"] = `Bearer ${token(opts.staff)}`;
  if (opts.restaurantId !== undefined)
    headers["x-restaurant-id"] = opts.restaurantId;
  return fetch(`${opts.url ?? baseUrl}/orders/${id}/status`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
}

/** A transition in this suite's restaurant, by `staffTest` unless said otherwise. */
const move = (id: string, body: unknown, staff = staffTest) =>
  patchStatus(id, body, { staff, restaurantId: shop });

async function moveOk(
  id: string,
  body: unknown,
  staff = staffTest,
): Promise<UpdateOrderStatusResponse> {
  const res = await move(id, body, staff);
  expect(res.status).toBe(200);
  return (await res.json()) as UpdateOrderStatusResponse;
}

/** The order as `GET /orders` lists it in this suite's restaurant. */
async function listed(
  id: string,
  tab: "active" | "history",
): Promise<UpdateOrderStatusResponse | undefined> {
  const res = await fetch(`${baseUrl}/orders?tab=${tab}`, {
    headers: {
      authorization: `Bearer ${token(staffTest)}`,
      "x-restaurant-id": shop,
    },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as OrderListResponse).orders.find(
    (o) => o.id === id,
  );
}

/** §8.7: Nest's own shape plus `code` — and `currentStatus` only when given. */
async function expectConflict(
  res: Response,
  expected: { code: OrderStatusConflictCode; currentStatus?: OrderStatus },
): Promise<void> {
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({
    statusCode: 409,
    error: "Conflict",
    message: expect.any(String),
    ...expected,
  });
}

async function expectNotFound(res: Response): Promise<void> {
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual(NOT_FOUND_BODY);
}

async function backendPid(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ pid: number }>(
    `SELECT pg_backend_pid() AS pid`,
  );
  return rows[0]!.pid;
}

/**
 * The backend waiting on a lock that `pid` holds, or null if none shows up in
 * time. Asked of Postgres, not guessed from timing.
 */
async function blockedBy(pid: number): Promise<number | null> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { rows } = await audit.query<{ pid: number }>(
      `SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))`,
      [pid],
    );
    if (rows[0]) return rows[0].pid;
    await new Promise((r) => setTimeout(r, 20));
  }
  return null;
}

beforeAll(async () => {
  const url = process.env["MIGRATION_DATABASE_URL"];
  if (!url)
    throw new Error(
      "MIGRATION_DATABASE_URL مفقود — الاختبار بيحتاجه ليسأل فوق RLS. انسخ .env.example لـ.env.",
    );
  audit = new Pool({ connectionString: url, max: 3 });

  const api = await startApi();
  app = api.app;
  baseUrl = api.url;
  jwt = app.get(JwtService);

  staffOnlyB = await createStaff("only-b");
  await addMember(staffOnlyB, RESTAURANT_B);
  staffTest = await createStaff("d4");
  staffColleague = await createStaff("d4-colleague");

  const r = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status)
     VALUES ($1, $2, 'active') RETURNING id`,
    [`مطعم ${RUN}`, `PHONE_${RUN}`],
  );
  shop = r.rows[0]!.id;
  createdRestaurants.push(shop);
  await addMember(staffTest, shop);
  await addMember(staffColleague, shop);
  const c = await audit.query<{ id: string }>(
    `INSERT INTO customers (restaurant_id, phone_number, name)
     VALUES ($1, $2, NULL) RETURNING id`,
    [shop, CUSTOMER_PHONE],
  );
  customerId = c.rows[0]!.id;
});

afterAll(async () => {
  await app?.close();
  if (audit) {
    if (createdRestaurants.length > 0)
      await audit.query(`DELETE FROM restaurants WHERE id = ANY($1::uuid[])`, [
        createdRestaurants,
      ]);
    if (createdStaff.length > 0)
      await audit.query(
        `DELETE FROM staff_accounts WHERE id = ANY($1::uuid[])`,
        [createdStaff],
      );
    await audit.end();
  }
});

// ---------------------------------------------------------------------------
// Transitions that go through — brief §2.6, §3.3 and §8.6.
// ---------------------------------------------------------------------------
describe("PATCH /orders/:id/status — transitions", () => {
  it("walks pending_acceptance → accepted → preparing → ready → completed: one history row per step, actor_staff_id from each step's token", async () => {
    const order = await createOrder({
      status: "pending_acceptance",
      fulfillment: "delivery",
    });
    // Money is the database's own text, fee included — never 6.5.
    expect(order.total).toBe("6.50");
    // Two staff taking turns: a cached or hard-coded actor shows up here.
    const steps = [
      ["pending_acceptance", "accepted", staffTest],
      ["accepted", "preparing", staffColleague],
      ["preparing", "ready", staffTest],
      ["ready", "completed", staffColleague],
    ] as const;

    for (const [from, to, staff] of steps) {
      const body = await moveOk(order.id, { from, to }, staff);
      expect(body).toEqual(itemOf(order, to));
      // The very projection GET /orders serves, not a second one (§3.3 step 4).
      expect(
        await listed(order.id, to === "completed" ? "history" : "active"),
      ).toEqual(body);
    }

    expect(await historyOf(order.id)).toEqual([
      {
        from_status: null,
        to_status: "pending_acceptance",
        actor: "customer",
        actor_staff_id: null,
        reason: null,
        changed_at: expect.any(String),
      },
      ...steps.map(([from, to, staff]) => ({
        from_status: from,
        to_status: to,
        actor: "staff",
        actor_staff_id: staff,
        reason: null,
        changed_at: expect.any(String),
      })),
    ]);
  });

  const staffPairs = ORDER_STATUSES.flatMap((from) =>
    STAFF_TRANSITIONS[from].map((to) => [from, to] as const),
  );

  it.each(staffPairs)(
    "%s → %s: 200, notified back to false, and updated_at stamped by the same transaction",
    async (from, to) => {
      const order = await createOrder({ status: from });
      expect((await stateOf(order.id)).notified).toBe(true);

      await moveOk(order.id, { from, to });

      const state = await stateOf(order.id);
      expect(state.status).toBe(to);
      // The notifier's one signal (FR-11). The API itself sends nothing.
      expect(state.notified).toBe(false);
      // now() of the UPDATE is now() of the history insert: one transaction.
      const last = (await historyOf(order.id)).at(-1);
      expect(state.updated_at).toBe(last?.changed_at);
    },
  );

  it("entering ready stamps ready_at, in the same UPDATE", async () => {
    const order = await createOrder({ status: "preparing" });

    await moveOk(order.id, { from: "preparing", to: "ready" });

    const state = await stateOf(order.id);
    expect(state.ready_at).not.toBeNull();
    expect(state.ready_at).toBe(state.updated_at);
  });

  it("preparing → completed directly: 200, collected, and ready_at stays NULL", async () => {
    const order = await createOrder({ status: "preparing" });

    const body = await moveOk(order.id, { from: "preparing", to: "completed" });

    expect(body).toEqual(itemOf(order, "completed"));
    expect(await stateOf(order.id)).toMatchObject({
      status: "completed",
      payment_status: "collected",
      ready_at: null,
    });
  });

  it("completed → a cash order is collected automatically, in the same UPDATE", async () => {
    const order = await createOrder({ status: "ready" });
    expect((await stateOf(order.id)).payment_status).toBe("pending_cash");

    await moveOk(order.id, { from: "ready", to: "completed" });

    expect(await stateOf(order.id)).toMatchObject({
      status: "completed",
      payment_status: "collected",
    });
  });

  it("an online order that is already paid completes and stays paid — collected is for cash alone", async () => {
    const order = await createOrder({
      status: "ready",
      paymentMethod: "online",
      paymentStatus: "paid",
    });

    await moveOk(order.id, { from: "ready", to: "completed" });

    expect(await stateOf(order.id)).toMatchObject({
      status: "completed",
      payment_status: "paid",
    });
  });
});

// ---------------------------------------------------------------------------
// Cancellation — brief §2.8, §8.2 and §8.6.
// ---------------------------------------------------------------------------
describe("PATCH /orders/:id/status — cancellation", () => {
  it("writes cancelled_by = 'restaurant' and the reason as written, edges trimmed, in the order and in its history row", async () => {
    const order = await createOrder({ status: "accepted" });
    // Inner spacing and the line break are the staff's own: kept.
    const written = "نفد الخبز،  والسائق غائب\nنعتذر";

    await moveOk(order.id, {
      from: "accepted",
      to: "cancelled",
      cancellationReason: `  ${written} \n `,
    });

    expect(await stateOf(order.id)).toMatchObject({
      status: "cancelled",
      cancelled_by: "restaurant",
      cancellation_reason: written,
    });
    expect((await historyOf(order.id)).at(-1)).toMatchObject({
      from_status: "accepted",
      to_status: "cancelled",
      actor: "staff",
      actor_staff_id: staffTest,
      reason: written,
    });
  });

  it.each([
    ["blank", "  \n   "],
    ["missing", undefined],
  ])(
    "a %s reason is stored as NULL, in the order and in its history row",
    async (_label, reason) => {
      const order = await createOrder({ status: "pending_acceptance" });

      await moveOk(order.id, {
        from: "pending_acceptance",
        to: "cancelled",
        ...(reason === undefined ? {} : { cancellationReason: reason }),
      });

      expect(await stateOf(order.id)).toMatchObject({
        status: "cancelled",
        cancelled_by: "restaurant",
        cancellation_reason: null,
      });
      expect((await historyOf(order.id)).at(-1)?.reason).toBeNull();
    },
  );

  it("a reason of exactly 300 characters is kept whole, spaces around it trimmed first", async () => {
    const order = await createOrder({ status: "ready" });
    const reason = "ن".repeat(300);

    await moveOk(order.id, {
      from: "ready",
      to: "cancelled",
      cancellationReason: `  ${reason}  `,
    });

    expect((await stateOf(order.id)).cancellation_reason).toBe(reason);
  });
});

// ---------------------------------------------------------------------------
// 🔴 The CAS — brief §2.7 and §3.3. `from` is what the staff member saw.
// ---------------------------------------------------------------------------
describe("PATCH /orders/:id/status — the CAS", () => {
  it("🔴 two requests at the same moment, same order, same from: one 200, one 409 status_conflict, and one history row", async () => {
    const order = await createOrder({ status: "pending_acceptance" });
    const accept = { from: "pending_acceptance", to: "accepted" };

    // A second instance, with a pool of its own: a second server behind a
    // load balancer, which is what lets two requests meet in Postgres.
    const rival = await startApi();
    const holder = await audit.connect();
    const inFlight: Promise<{ status: number; body: unknown }>[] = [];
    // Text first: a 200 with no body has to fail the status check below, not
    // crash here parsing JSON — a test that falls for another reason proves
    // nothing.
    const settle = (res: Promise<Response>) =>
      res.then(async (r) => {
        const text = await r.text();
        return {
          status: r.status,
          body: text ? (JSON.parse(text) as unknown) : undefined,
        };
      });
    let results: { status: number; body: unknown }[];
    let loserWaitedOnWinner: boolean;
    try {
      // No history insert gets past this. The first request runs its UPDATE,
      // taking the order's row lock, and stops at its insert holding it.
      await holder.query("BEGIN");
      await holder.query("LOCK TABLE order_status_history IN SHARE MODE");
      const holderPid = await backendPid(holder);

      inFlight.push(
        settle(
          patchStatus(order.id, accept, {
            staff: staffTest,
            restaurantId: shop,
          }),
        ),
      );
      const winnerPid = await blockedBy(holderPid);
      if (winnerPid === null)
        throw new Error("the first request never reached its history insert");

      inFlight.push(
        settle(
          patchStatus(order.id, accept, {
            staff: staffColleague,
            restaurantId: shop,
            url: rival.url,
          }),
        ),
      );
      loserWaitedOnWinner = (await blockedBy(winnerPid)) !== null;

      await holder.query("COMMIT");
      results = await Promise.all(inFlight);
    } finally {
      await holder.query("ROLLBACK"); // a no-op once committed
      holder.release();
      await Promise.allSettled(inFlight);
      await rival.app.close();
    }
    const [first, second] = results;

    // 1. The first one through; the second told why not, and what is true now.
    expect([first?.status, second?.status]).toEqual([200, 409]);
    expect(first?.body).toEqual(itemOf(order, "accepted"));
    expect(second?.body).toEqual({
      statusCode: 409,
      error: "Conflict",
      code: "status_conflict",
      message: expect.any(String),
      currentStatus: "accepted",
    });
    // 2. One history row, signed by the winner's token.
    expect(staffRows(await historyOf(order.id))).toEqual([
      expect.objectContaining({
        from_status: "pending_acceptance",
        to_status: "accepted",
        actor_staff_id: staffTest,
      }),
    ]);
    expect((await stateOf(order.id)).status).toBe("accepted");
    // 3. 🔴 Proof the two really met, rather than ran one after the other.
    //    Last on purpose: without the CAS this test must fail at 1, not here.
    expect(loserWaitedOnWinner).toBe(true);
  });

  it("🔴 a stale screen: pending_acceptance → cancelled on an order a colleague already moved to preparing is 409 with currentStatus, and the order is not cancelled", async () => {
    const order = await createOrder({ status: "pending_acceptance" });
    // The colleague accepts and starts it, while this screen still shows «معلّق».
    await moveOk(
      order.id,
      { from: "pending_acceptance", to: "accepted" },
      staffColleague,
    );
    await moveOk(
      order.id,
      { from: "accepted", to: "preparing" },
      staffColleague,
    );
    await audit.query(`UPDATE orders SET notified = true WHERE id = $1`, [
      order.id,
    ]);
    const before = await stateOf(order.id);
    const historyBefore = await historyOf(order.id);

    const res = await move(order.id, {
      from: "pending_acceptance",
      to: "cancelled",
      cancellationReason: "الزبون لم يرد",
    });

    await expectConflict(res, {
      code: "status_conflict",
      currentStatus: "preparing",
    });
    // Nothing moved: still in the kitchen, no reason, no history row, and not
    // even `notified`.
    expect(await stateOf(order.id)).toEqual(before);
    expect(await historyOf(order.id)).toEqual(historyBefore);
  });
});

// ---------------------------------------------------------------------------
// Forbidden transitions — brief §2.6 and §3.3 check 2.
// ---------------------------------------------------------------------------
describe("PATCH /orders/:id/status — forbidden transitions", () => {
  it.each([
    ["from a final status", "completed", "cancelled"],
    ["from a final status", "cancelled", "accepted"],
    ["from a final status", "expired", "cancelled"],
    ["skipping a step", "pending_acceptance", "preparing"],
    ["skipping a step", "pending_acceptance", "completed"],
    ["skipping a step", "accepted", "ready"],
    ["skipping a step", "accepted", "completed"],
    ["going back", "preparing", "accepted"],
    ["going back", "ready", "preparing"],
    ["going back", "completed", "ready"],
    ["staying put", "accepted", "accepted"],
  ] as const)(
    "%s: %s → %s is 409 transition_not_allowed, and the order is untouched",
    async (_kind, from, to) => {
      const order = await createOrder({ status: from });
      const before = await stateOf(order.id);
      const historyBefore = await historyOf(order.id);

      await expectConflict(await move(order.id, { from, to }), {
        code: "transition_not_allowed",
      });

      expect(await stateOf(order.id)).toEqual(before);
      expect(await historyOf(order.id)).toEqual(historyBefore);
    },
  );

  it("is decided before any lookup: on an id that exists nowhere it is still transition_not_allowed", async () => {
    await expectConflict(
      await move(NO_SUCH_ORDER, { from: "completed", to: "cancelled" }),
      { code: "transition_not_allowed" },
    );
  });
});

// ---------------------------------------------------------------------------
// 🔴 A non-cash order — brief §8.6, on the seed's own online order.
// ---------------------------------------------------------------------------
describe("PATCH /orders/:id/status — payment", () => {
  it("🔴 restaurant B's online order from the seed cannot be completed unpaid: 409 payment_not_settled, and nothing changes", async () => {
    // The seed holds it in pending_acceptance, where `completed` is not a
    // staff transition at all — that would be transition_not_allowed and
    // prove nothing about payment. Move it to preparing, and put it back
    // exactly as it was: other suites read the seed.
    const { rows } = await audit.query<OrderState>(
      `SELECT status, payment_status, notified,
              ready_at::text AS ready_at, updated_at::text AS updated_at,
              cancelled_by, cancellation_reason
         FROM orders WHERE id = $1`,
      [SEED_ORDER_B],
    );
    const seeded = rows[0]!;
    const seededHistory = await historyOf(SEED_ORDER_B);
    expect(seeded).toMatchObject({
      payment_status: "pending_online",
      status: "pending_acceptance",
    });

    try {
      await audit.query(
        `UPDATE orders SET status = 'preparing' WHERE id = $1`,
        [SEED_ORDER_B],
      );
      const before = await stateOf(SEED_ORDER_B);

      const res = await patchStatus(
        SEED_ORDER_B,
        { from: "preparing", to: "completed" },
        { staff: staffOnlyB, restaurantId: RESTAURANT_B },
      );

      await expectConflict(res, { code: "payment_not_settled" });
      expect(await stateOf(SEED_ORDER_B)).toEqual(before);
      expect(await historyOf(SEED_ORDER_B)).toEqual(seededHistory);
    } finally {
      await audit.query(
        `DELETE FROM order_status_history
          WHERE order_id = $1 AND actor = 'staff'`,
        [SEED_ORDER_B],
      );
      await audit.query(
        `UPDATE orders
            SET status = $2::order_status,
                payment_status = $3::payment_status,
                notified = $4,
                ready_at = $5::timestamptz,
                updated_at = $6::timestamptz,
                cancelled_by = $7::cancelled_by,
                cancellation_reason = $8
          WHERE id = $1`,
        [
          SEED_ORDER_B,
          seeded.status,
          seeded.payment_status,
          seeded.notified,
          seeded.ready_at,
          seeded.updated_at,
          seeded.cancelled_by,
          seeded.cancellation_reason,
        ],
      );
    }
    expect(await stateOf(SEED_ORDER_B)).toEqual(seeded);
    expect(await historyOf(SEED_ORDER_B)).toEqual(seededHistory);
  });
});

// ---------------------------------------------------------------------------
// 🔴 Isolation — brief §2.9 and §8.1. Another restaurant's order is 404, with
//    the very body a non-existent id gets, and it does not move.
// ---------------------------------------------------------------------------
describe("PATCH /orders/:id/status — isolation", () => {
  const acceptA = { from: "pending_acceptance", to: "accepted" };

  it("🔴 an order of restaurant A patched by the staff of restaurant B is 404, and A's order is untouched", async () => {
    const before = await stateOf(SEED_ORDER_A);
    const historyBefore = await historyOf(SEED_ORDER_A);

    await expectNotFound(
      await patchStatus(SEED_ORDER_A, acceptA, {
        staff: staffOnlyB,
        restaurantId: RESTAURANT_B,
      }),
    );

    expect(await stateOf(SEED_ORDER_A)).toEqual(before);
    expect(await historyOf(SEED_ORDER_A)).toEqual(historyBefore);
  });

  // The caller is a member of both branches: only the per-request context
  // stands between B's screen and A's order.
  it("dual-branch staff under B's header cannot move A's order either: 404", async () => {
    const before = await stateOf(SEED_ORDER_A);

    await expectNotFound(
      await patchStatus(SEED_ORDER_A, acceptA, {
        staff: STAFF_BOTH,
        restaurantId: RESTAURANT_B,
      }),
    );

    expect(await stateOf(SEED_ORDER_A)).toEqual(before);
  });

  it("B-only staff sending A's header is refused by the guard, and A's order is untouched", async () => {
    const before = await stateOf(SEED_ORDER_A);

    const res = await patchStatus(SEED_ORDER_A, acceptA, {
      staff: staffOnlyB,
      restaurantId: RESTAURANT_A,
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ message: "Forbidden", statusCode: 403 });
    expect(await stateOf(SEED_ORDER_A)).toEqual(before);
  });

  it("a well-formed id that belongs to no order is 404, same body as another restaurant's", async () => {
    await expectNotFound(await move(NO_SUCH_ORDER, acceptA));
  });
});

// ---------------------------------------------------------------------------
// 🔴 One transaction — brief §3.3 step 5: no status changes without its
//    history row.
// ---------------------------------------------------------------------------
describe("PATCH /orders/:id/status — one transaction", () => {
  it("🔴 a failure forced at the history insert — after the UPDATE — leaves the order exactly as it was", async () => {
    const order = await createOrder({ status: "preparing" });
    const before = await stateOf(order.id);
    const historyBefore = await historyOf(order.id);

    // A real failure from the database, at the last step. It fires only once
    // the UPDATE is in — this transaction already sees the new status — and
    // counts itself on a sequence, which the rollback does not undo.
    await audit.query(`DROP SEQUENCE IF EXISTS sufria_test_history_failures`);
    await audit.query(`CREATE SEQUENCE sufria_test_history_failures`);
    await audit.query(
      `GRANT USAGE ON SEQUENCE sufria_test_history_failures TO PUBLIC`,
    );
    await audit.query(`
      CREATE OR REPLACE FUNCTION sufria_test_fail_history_after_update()
      RETURNS trigger AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM orders
                    WHERE id = NEW.order_id AND status = NEW.to_status) THEN
          PERFORM nextval('sufria_test_history_failures');
          RAISE EXCEPTION 'forced failure at the history insert, after the UPDATE';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await audit.query(`
      CREATE TRIGGER sufria_test_fail_history_after_update_trg
      BEFORE INSERT ON order_status_history
      FOR EACH ROW WHEN (NEW.order_id = '${order.id}')
      EXECUTE FUNCTION sufria_test_fail_history_after_update()`);

    let res: Response;
    let fired: number;
    try {
      res = await move(order.id, {
        from: "preparing",
        to: "cancelled",
        cancellationReason: "نفد الخبز",
      });
    } finally {
      await audit.query(
        `DROP TRIGGER IF EXISTS sufria_test_fail_history_after_update_trg
           ON order_status_history`,
      );
      await audit.query(
        `DROP FUNCTION IF EXISTS sufria_test_fail_history_after_update()`,
      );
      const seq = await audit.query<{ last_value: string; is_called: boolean }>(
        `SELECT last_value, is_called FROM sufria_test_history_failures`,
      );
      fired = seq.rows[0]!.is_called ? Number(seq.rows[0]!.last_value) : 0;
      await audit.query(`DROP SEQUENCE IF EXISTS sufria_test_history_failures`);
    }

    // Nest's own 500 — no database detail reaches the client.
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      statusCode: 500,
      message: "Internal server error",
    });
    // It was the history insert that failed, with the UPDATE already in.
    expect(fired).toBe(1);
    // ...and the UPDATE went back with it.
    expect(await stateOf(order.id)).toEqual(before);
    expect(await historyOf(order.id)).toEqual(historyBefore);
  });
});

// ---------------------------------------------------------------------------
// Input — brief §3.3 check 1 and §8.7: 400 in nestjs-zod's existing shape,
// before the transition is even looked at.
// ---------------------------------------------------------------------------
describe("PATCH /orders/:id/status — input", () => {
  const expectZod400 = async (res: Response): Promise<void> => {
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["statusCode"]).toBe(400);
    expect(body["message"]).toBe("Validation failed");
    expect(Array.isArray(body["errors"])).toBe(true);
  };

  it.each([
    [
      "to: expired — the system's, never staff's, though canTransition allows it from ready",
      { from: "ready", to: "expired" },
    ],
    ["to: pending_acceptance", { from: "accepted", to: "pending_acceptance" }],
    [
      "a reason with a destination other than cancelled",
      { from: "accepted", to: "preparing", cancellationReason: "سبب" },
    ],
    [
      "an empty reason with a destination other than cancelled",
      { from: "accepted", to: "preparing", cancellationReason: "" },
    ],
    [
      "a reason of 301 characters",
      {
        from: "accepted",
        to: "cancelled",
        cancellationReason: "ن".repeat(301),
      },
    ],
    [
      "a reason that is not a string",
      { from: "accepted", to: "cancelled", cancellationReason: 7 },
    ],
    ["no from", { to: "preparing" }],
    ["no to", { from: "accepted" }],
    ["an empty body", {}],
    ["an unknown status", { from: "accepted", to: "on_the_way" }],
    ["a status that is not a string", { from: 1, to: "preparing" }],
    [
      "a key the contract does not have (restaurantId)",
      { from: "accepted", to: "preparing", restaurantId: RESTAURANT_B },
    ],
    [
      "a pair that is also not a transition — 400 comes before 409",
      { from: "completed", to: "pending_acceptance" },
    ],
  ])(
    "rejects %s with 400, and the order is untouched",
    async (_label, body) => {
      const order = await createOrder({ status: "accepted" });
      const before = await stateOf(order.id);

      await expectZod400(await move(order.id, body));

      expect(await stateOf(order.id)).toEqual(before);
    },
  );

  it("rejects an id that is not a UUID with 400", async () => {
    await expectZod400(
      await move("not-a-uuid", { from: "accepted", to: "preparing" }),
    );
  });

  it("rejects a request without a token with 401", async () => {
    const res = await patchStatus(
      SEED_ORDER_A,
      { from: "pending_acceptance", to: "accepted" },
      { restaurantId: RESTAURANT_A },
    );
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 🔴 Not one WhatsApp message from the API — brief §0 and D-0 check 13.
//    A status change sets `notified = false` and nothing else; the notifier
//    (FR-11) decides and sends. Nothing in dashboard-api can send today, and
//    this keeps it that way.
// ---------------------------------------------------------------------------
describe("PATCH /orders/:id/status — no WhatsApp", () => {
  it("nothing in dashboard-api reaches a WhatsApp sender, the Graph API, or the engine", () => {
    const src = resolve(__dirname, "../src");
    const files = readdirSync(src, {
      recursive: true,
      encoding: "utf8",
    }).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter((f) =>
      /WhatsAppSender|graph\.facebook\.com|conversation-engine/.test(
        readFileSync(join(src, f), "utf8"),
      ),
    );
    expect(offenders).toEqual([]);

    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, "../package.json"), "utf8"),
    ) as Record<string, Record<string, string> | undefined>;
    expect(
      Object.keys({ ...pkg["dependencies"], ...pkg["devDependencies"] }),
    ).not.toContain("@sufria/conversation-engine");
  });
});
