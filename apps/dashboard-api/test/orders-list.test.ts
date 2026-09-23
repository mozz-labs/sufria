/**
 * د-2 — `GET /orders` (بريف د §3.1، مع §8.1 و§8.7).
 *
 * Real HTTP through the real AppModule — the same global JwtAuthGuard and
 * ZodValidationPipe production runs — into Postgres as `sufria_dashboard`, so
 * RLS is live. Fixtures are written through MIGRATION_DATABASE_URL, which is
 * also the audit connection: "does every returned order belong to the header's
 * restaurant?" has to be asked from above RLS, because from inside it the
 * answer is always yes.
 *
 * 🔴 The three isolation tests (§8.1) run against the seeded chain, where the
 *    dual-branch staff account lives. The seed has no staff account that is a
 *    member of B alone, so this suite creates one for the run — a mirror of
 *    ONLY_A, not a change to the fixture.
 *
 * Ordering and paging run in restaurants this suite creates, so the lists are
 * exact and nothing another suite writes to the seeded restaurants can move them.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import type { OrderListResponse } from "@sufria/shared";

import { AppModule } from "../src/app.module.js";

const RESTAURANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RESTAURANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CUSTOMER_A = "c0000000-0000-4000-8000-00000000000a";
const CUSTOMER_B = "c0000000-0000-4000-8000-00000000000b";
const SEED_ORDER_A = "f0000000-0000-4000-8000-00000000000a";
const SEED_ORDER_B = "f0000000-0000-4000-8000-00000000000b";
const STAFF_BOTH = "50000000-0000-4000-8000-000000000001";

const RUN = `d2-${process.pid}-${Date.now()}`;
const BASE = Date.parse("2026-01-01T08:00:00.000Z");
const at = (minutes: number): string =>
  new Date(BASE + minutes * 60_000).toISOString();

let app: INestApplication;
let baseUrl: string;
let jwt: JwtService;
let audit: Pool;

const createdRestaurants: string[] = [];
const createdStaff: string[] = [];
/** Orders this suite adds to the *seeded* restaurants; deleted by id. */
const seededRestaurantOrders: string[] = [];

let staffOnlyB = "";
let staffTest = "";

type OrderSpec = {
  status: string;
  createdAt: string;
  fulfillment?: "pickup" | "delivery";
  subtotal?: string;
  fee?: string;
  lines?: number;
};

type Shop = { restaurantId: string; customerId: string; nextNumber: number };

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

async function addMember(staffId: string, restaurantId: string): Promise<void> {
  await audit.query(
    `INSERT INTO restaurant_staff (staff_account_id, restaurant_id, role, is_active)
     VALUES ($1, $2, 'staff', true)`,
    [staffId, restaurantId],
  );
}

async function createShop(label: string): Promise<Shop> {
  const r = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status)
     VALUES ($1, $2, 'active') RETURNING id`,
    [`مطعم ${label} ${RUN}`, `PHONE_${label}_${RUN}`],
  );
  const restaurantId = r.rows[0]!.id;
  createdRestaurants.push(restaurantId);
  const c = await audit.query<{ id: string }>(
    `INSERT INTO customers (restaurant_id, phone_number, name)
     VALUES ($1, '+962791234567', NULL) RETURNING id`,
    [restaurantId],
  );
  return { restaurantId, customerId: c.rows[0]!.id, nextNumber: 101 };
}

/**
 * One order, shaped to satisfy every CHECK on `orders`: cancelled carries
 * `cancelled_by`, completed is cash and collected, delivery has an address and
 * total = subtotal + fee.
 */
async function insertOrder(
  restaurantId: string,
  customerId: string,
  orderNumber: number,
  spec: OrderSpec,
): Promise<string> {
  const fulfillment = spec.fulfillment ?? "pickup";
  const subtotal = spec.subtotal ?? "5.00";
  const fee = fulfillment === "delivery" ? (spec.fee ?? "1.50") : "0";
  const paymentStatus =
    spec.status === "completed" ? "collected" : "pending_cash";
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO orders (restaurant_id, customer_id, order_number, fulfillment_type,
                         payment_method, status, payment_status, cancelled_by,
                         subtotal, delivery_fee, total, delivery_address, created_at)
     VALUES ($1, $2, $3, $4::fulfillment_type, 'cash', $5::order_status,
             $6::payment_status,
             CASE WHEN $5 = 'cancelled' THEN 'restaurant'::cancelled_by END,
             $7::numeric, $8::numeric, $7::numeric + $8::numeric,
             CASE WHEN $4 = 'delivery' THEN 'شارع الجامعة' END, $9::timestamptz)
     RETURNING id`,
    [
      restaurantId,
      customerId,
      orderNumber,
      fulfillment,
      spec.status,
      paymentStatus,
      subtotal,
      fee,
      spec.createdAt,
    ],
  );
  const id = rows[0]!.id;
  for (let i = 0; i < (spec.lines ?? 0); i++) {
    await audit.query(
      `INSERT INTO order_items (order_id, restaurant_id, item_name_snapshot,
                                unit_price_snapshot, quantity)
       VALUES ($1, $2, $3, 1.00, 1)`,
      [id, restaurantId, `صنف ${i + 1}`],
    );
  }
  return id;
}

const addToShop = (shop: Shop, spec: OrderSpec): Promise<string> =>
  insertOrder(shop.restaurantId, shop.customerId, shop.nextNumber++, spec);

/** An order added to a seeded restaurant, numbered after whatever is there. */
async function addToSeeded(
  restaurantId: string,
  customerId: string,
  spec: OrderSpec,
): Promise<string> {
  const { rows } = await audit.query<{ n: number }>(
    `SELECT COALESCE(MAX(order_number), 100) + 1 AS n FROM orders WHERE restaurant_id = $1`,
    [restaurantId],
  );
  const id = await insertOrder(restaurantId, customerId, rows[0]!.n, spec);
  seededRestaurantOrders.push(id);
  return id;
}

const token = (staffAccountId: string): string =>
  jwt.sign({ sub: staffAccountId, typ: "access" });

async function getOrders(
  query: string,
  opts: { staff?: string; restaurantId?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.staff !== undefined)
    headers["authorization"] = `Bearer ${token(opts.staff)}`;
  if (opts.restaurantId !== undefined)
    headers["x-restaurant-id"] = opts.restaurantId;
  return fetch(`${baseUrl}/orders${query}`, { headers });
}

async function listOk(
  query: string,
  staff: string,
  restaurantId: string,
): Promise<OrderListResponse> {
  const res = await getOrders(query, { staff, restaurantId });
  expect(res.status).toBe(200);
  return (await res.json()) as OrderListResponse;
}

/** Which restaurant each order really belongs to — asked above RLS. */
async function ownersOf(ids: string[]): Promise<string[]> {
  const { rows } = await audit.query<{ restaurant_id: string }>(
    `SELECT DISTINCT restaurant_id FROM orders WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return rows.map((r) => r.restaurant_id);
}

const ids = (body: OrderListResponse): string[] => body.orders.map((o) => o.id);

beforeAll(async () => {
  const url = process.env["MIGRATION_DATABASE_URL"];
  if (!url)
    throw new Error(
      "MIGRATION_DATABASE_URL مفقود — الاختبار بيحتاجه ليسأل فوق RLS. انسخ .env.example لـ.env.",
    );
  audit = new Pool({ connectionString: url, max: 2 });

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0);
  baseUrl = (await app.getUrl()).replace("[::1]", "127.0.0.1");
  jwt = app.get(JwtService);

  staffOnlyB = await createStaff("only-b");
  await addMember(staffOnlyB, RESTAURANT_B);
  staffTest = await createStaff("d2");

  // A history order in each seeded branch, so isolation is checked in both tabs.
  await addToSeeded(RESTAURANT_A, CUSTOMER_A, {
    status: "cancelled",
    createdAt: at(0),
  });
  await addToSeeded(RESTAURANT_B, CUSTOMER_B, {
    status: "completed",
    createdAt: at(0),
  });
});

afterAll(async () => {
  await app?.close();
  if (audit) {
    if (seededRestaurantOrders.length > 0)
      await audit.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [
        seededRestaurantOrders,
      ]);
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
// 🔴 Isolation — brief §8.1. The restaurant is whatever RestaurantContextGuard
//    verified, and nothing else.
// ---------------------------------------------------------------------------
describe("GET /orders — isolation", () => {
  it.each(["active", "history"])(
    "an order of restaurant A never reaches the staff of restaurant B (tab=%s)",
    async (tab) => {
      const body = await listOk(`?tab=${tab}`, staffOnlyB, RESTAURANT_B);

      expect(body.orders.length).toBeGreaterThan(0);
      expect(await ownersOf(ids(body))).toEqual([RESTAURANT_B]);
      expect(ids(body)).not.toContain(SEED_ORDER_A);
    },
  );

  it.each(["active", "history"])(
    "B-only staff sending A's header is refused by the guard, with zero orders (tab=%s)",
    async (tab) => {
      const res = await getOrders(`?tab=${tab}`, {
        staff: staffOnlyB,
        restaurantId: RESTAURANT_A,
      });

      expect(res.status).toBe(403);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body["orders"]).toBeUndefined();
    },
  );

  // 🔴 The case "the token carries no restaurant" does not cover by itself: the
  //    caller really is a member of both, so only the per-request context stands
  //    between branch A's list and branch B's orders.
  it.each(["active", "history"])(
    "dual-branch staff sees A's orders alone under A's header, and B's alone under B's (tab=%s)",
    async (tab) => {
      const underA = await listOk(`?tab=${tab}`, STAFF_BOTH, RESTAURANT_A);
      const underB = await listOk(`?tab=${tab}`, STAFF_BOTH, RESTAURANT_B);

      expect(underA.orders.length).toBeGreaterThan(0);
      expect(underB.orders.length).toBeGreaterThan(0);
      expect(await ownersOf(ids(underA))).toEqual([RESTAURANT_A]);
      expect(await ownersOf(ids(underB))).toEqual([RESTAURANT_B]);
      if (tab === "active") {
        expect(ids(underA)).toContain(SEED_ORDER_A);
        expect(ids(underA)).not.toContain(SEED_ORDER_B);
        expect(ids(underB)).toContain(SEED_ORDER_B);
        expect(ids(underB)).not.toContain(SEED_ORDER_A);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Tabs, ordering, and the shape of one item — brief §2.5 and §3.1.
// ---------------------------------------------------------------------------
describe("GET /orders — tabs and ordering", () => {
  let shop: Shop;
  const o: Record<string, string> = {};

  beforeAll(async () => {
    shop = await createShop("SORT");
    await addMember(staffTest, shop.restaurantId);

    // Inserted out of order on purpose: the database's insertion order must
    // not be what the test ends up checking.
    o["preparing"] = await addToShop(shop, {
      status: "preparing",
      createdAt: at(20),
      lines: 1,
    });
    o["pending"] = await addToShop(shop, {
      status: "pending_acceptance",
      createdAt: at(0),
      fulfillment: "delivery",
      subtotal: "12.00",
      fee: "1.50",
      lines: 3,
    });
    o["ready"] = await addToShop(shop, {
      status: "ready",
      createdAt: at(10),
    });
    o["cancelled"] = await addToShop(shop, {
      status: "cancelled",
      createdAt: at(15),
    });
    o["completed"] = await addToShop(shop, {
      status: "completed",
      createdAt: at(5),
      subtotal: "7.10",
    });
    o["expired"] = await addToShop(shop, {
      status: "expired",
      createdAt: at(25),
    });
    o["accepted"] = await addToShop(shop, {
      status: "accepted",
      createdAt: at(30),
    });
  });

  it("active returns only the four live statuses, oldest first", async () => {
    const body = await listOk("?tab=active", staffTest, shop.restaurantId);

    expect(ids(body)).toEqual([
      o["pending"],
      o["ready"],
      o["preparing"],
      o["accepted"],
    ]);
    expect(body.page).toBe(1);
    expect(body.hasMore).toBe(false);
  });

  it("history returns only completed, cancelled and expired, newest first", async () => {
    const body = await listOk("?tab=history", staffTest, shop.restaurantId);

    expect(ids(body)).toEqual([o["expired"], o["cancelled"], o["completed"]]);
    expect(body.page).toBe(1);
    expect(body.hasMore).toBe(false);
  });

  it("breaks a created_at tie by id, in the tab's own direction", async () => {
    const tie = await createShop("TIE");
    await addMember(staffTest, tie.restaurantId);
    const same = at(40);
    const x = await addToShop(tie, { status: "accepted", createdAt: same });
    const y = await addToShop(tie, { status: "accepted", createdAt: same });
    const p = await addToShop(tie, { status: "completed", createdAt: same });
    const q = await addToShop(tie, { status: "completed", createdAt: same });
    const [lo, hi] = [x, y].sort();
    const [hlo, hhi] = [p, q].sort();

    const active = await listOk("?tab=active", staffTest, tie.restaurantId);
    const history = await listOk("?tab=history", staffTest, tie.restaurantId);

    expect(ids(active)).toEqual([lo, hi]);
    expect(ids(history)).toEqual([hhi, hlo]);
  });

  it("carries money as the database's own text and the stored order number", async () => {
    const body = await listOk("?tab=active", staffTest, shop.restaurantId);
    const item = body.orders.find((x) => x.id === o["pending"]);
    const { rows } = await audit.query<{
      total: string;
      order_number: number;
      created_at: string;
    }>(
      `SELECT total::text AS total, order_number,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM orders WHERE id = $1`,
      [o["pending"]],
    );

    // "13.50", not 13.5 and not "13.5": the trailing zero is the point.
    expect(item?.total).toBe("13.50");
    expect(item?.total).toBe(rows[0]!.total);
    expect(item?.orderNumber).toBe(rows[0]!.order_number);
    expect(item).toEqual({
      id: o["pending"],
      orderNumber: rows[0]!.order_number,
      status: "pending_acceptance",
      fulfillmentType: "delivery",
      total: "13.50",
      itemCount: 3,
      createdAt: at(0),
      customer: { name: null, phone: "+962791234567" },
    });
    expect(rows[0]!.created_at).toBe(at(0));
  });

  it("counts order lines, and an order with none counts zero", async () => {
    const body = await listOk("?tab=active", staffTest, shop.restaurantId);
    const count = (id: string | undefined) =>
      body.orders.find((x) => x.id === id)?.itemCount;

    expect(count(o["pending"])).toBe(3);
    expect(count(o["preparing"])).toBe(1);
    expect(count(o["ready"])).toBe(0);
  });

  it("history keeps a trailing-zero total as text too", async () => {
    const body = await listOk("?tab=history", staffTest, shop.restaurantId);
    expect(body.orders.find((x) => x.id === o["completed"])?.total).toBe(
      "7.10",
    );
  });
});

// ---------------------------------------------------------------------------
// Paging — brief §3.1: read 21, return 20, no COUNT.
// ---------------------------------------------------------------------------
describe("GET /orders — history paging", () => {
  let shop: Shop;
  const history: string[] = [];

  beforeAll(async () => {
    shop = await createShop("PAGE");
    await addMember(staffTest, shop.restaurantId);
    for (let i = 0; i < 25; i++) {
      history.push(
        await addToShop(shop, {
          status: i % 2 === 0 ? "completed" : "cancelled",
          createdAt: at(i),
        }),
      );
    }
    await addToShop(shop, { status: "pending_acceptance", createdAt: at(100) });
  });

  it("25 history orders: page 1 is the newest 20 with hasMore", async () => {
    const body = await listOk(
      "?tab=history&page=1",
      staffTest,
      shop.restaurantId,
    );

    expect(body.orders).toHaveLength(20);
    expect(ids(body)).toEqual(history.slice(5).reverse());
    expect(body.page).toBe(1);
    expect(body.hasMore).toBe(true);
  });

  it("page 2 is the remaining 5 without hasMore", async () => {
    const body = await listOk(
      "?tab=history&page=2",
      staffTest,
      shop.restaurantId,
    );

    expect(body.orders).toHaveLength(5);
    expect(ids(body)).toEqual(history.slice(0, 5).reverse());
    expect(body.page).toBe(2);
    expect(body.hasMore).toBe(false);
  });

  it("page defaults to 1 when it is not sent", async () => {
    const body = await listOk("?tab=history", staffTest, shop.restaurantId);
    expect(body.page).toBe(1);
    expect(body.orders).toHaveLength(20);
    expect(body.hasMore).toBe(true);
  });

  it("a page past the end is empty, not an error", async () => {
    const body = await listOk(
      "?tab=history&page=3",
      staffTest,
      shop.restaurantId,
    );
    expect(body.orders).toEqual([]);
    expect(body.hasMore).toBe(false);
  });

  it("active ignores a valid page: always page 1, every order, no hasMore", async () => {
    const body = await listOk(
      "?tab=active&page=3",
      staffTest,
      shop.restaurantId,
    );
    expect(body.orders).toHaveLength(1);
    expect(body.page).toBe(1);
    expect(body.hasMore).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Input — brief §3.1 and §8.7: 400 in nestjs-zod's existing shape, 401 without
// a token.
// ---------------------------------------------------------------------------
describe("GET /orders — input", () => {
  const expectZod400 = async (res: Response): Promise<void> => {
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["statusCode"]).toBe(400);
    expect(body["message"]).toBe("Validation failed");
    expect(Array.isArray(body["errors"])).toBe(true);
  };

  it.each([
    ["missing tab", ""],
    ["unknown tab", "?tab=open"],
    ["tab sent twice", "?tab=active&tab=history"],
  ])("rejects a %s with 400", async (_label, query) => {
    await expectZod400(
      await getOrders(query, { staff: STAFF_BOTH, restaurantId: RESTAURANT_A }),
    );
  });

  it.each(["active", "history"])(
    "rejects page=0, page=x, page=-1 and page=1.5 with 400 even on tab=%s",
    async (tab) => {
      for (const page of ["0", "x", "-1", "1.5", ""]) {
        await expectZod400(
          await getOrders(`?tab=${tab}&page=${page}`, {
            staff: STAFF_BOTH,
            restaurantId: RESTAURANT_A,
          }),
        );
      }
    },
  );

  it("rejects a request without a token with 401", async () => {
    const res = await getOrders("?tab=active", { restaurantId: RESTAURANT_A });
    expect(res.status).toBe(401);
  });

  it("rejects a request without a restaurant header with 400", async () => {
    const res = await getOrders("?tab=active", { staff: STAFF_BOTH });
    expect(res.status).toBe(400);
  });

  it("ignores a restaurantId in the query string", async () => {
    // The guard reads params, then the header — never the query. A query value
    // naming the other branch changes nothing.
    const body = await listOk(
      `?tab=active&restaurantId=${RESTAURANT_B}`,
      STAFF_BOTH,
      RESTAURANT_A,
    );
    expect(await ownersOf(ids(body))).toEqual([RESTAURANT_A]);
  });
});
