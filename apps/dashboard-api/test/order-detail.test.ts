/**
 * د-3 — `GET /orders/:id` (بريف د §3.2، مع §8.1 و§8.7).
 *
 * Same harness as orders-list.test.ts: the real AppModule over real HTTP, into
 * Postgres as `sufria_dashboard` with RLS live, and fixtures written — and
 * audited — through MIGRATION_DATABASE_URL.
 *
 * 🔴 Every order line in this suite points at a menu item whose *current* name
 *    and price equal its snapshot, except in the one test that changes the menu
 *    after ordering. That keeps the break control honest: reading the menu
 *    instead of the snapshot must fail that test and nothing else.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import type { OrderDetail } from "@sufria/shared";

import { AppModule } from "../src/app.module.js";

const RESTAURANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RESTAURANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SEED_ORDER_A = "f0000000-0000-4000-8000-00000000000a";
const SEED_ORDER_B = "f0000000-0000-4000-8000-00000000000b";
const STAFF_BOTH = "50000000-0000-4000-8000-000000000001";
/** Well-formed, and belongs to no order anywhere. */
const NO_SUCH_ORDER = "f0000000-0000-4000-8000-0000000000ff";

const RUN = `d3-${process.pid}-${Date.now()}`;
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
let restaurantId = "";
let customerId = "";
let nextNumber = 101;
const menu: Record<string, string> = {};

type Line = { item: string; name: string; price: string; quantity: number };
type History = {
  from: string | null;
  to: string;
  actor: "customer" | "staff";
  at: string;
};

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

async function addMenuItem(
  categoryId: string,
  name: string,
  price: string,
): Promise<void> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO menu_items (restaurant_id, category_id, name, price)
     VALUES ($1, $2, $3, $4::numeric) RETURNING id`,
    [restaurantId, categoryId, name, price],
  );
  menu[name] = rows[0]!.id;
}

/**
 * One order, its lines, and its history. Subtotal and total are computed by
 * Postgres from the lines, so the fixture never does money arithmetic in JS
 * either, and `total = subtotal + delivery_fee` holds by construction.
 */
async function createOrder(spec: {
  status: string;
  fulfillment: "pickup" | "delivery";
  fee?: string;
  lines: Line[];
  history: History[];
  cancellationReason?: string;
}): Promise<string> {
  const fee = spec.fulfillment === "delivery" ? (spec.fee ?? "1.50") : "0";
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO orders (restaurant_id, customer_id, order_number, fulfillment_type,
                         payment_method, status, payment_status, cancelled_by,
                         cancellation_reason, subtotal, delivery_fee, total,
                         delivery_address, created_at)
     VALUES ($1, $2, $3, $4::fulfillment_type, 'cash', $5::order_status, 'pending_cash',
             CASE WHEN $5 = 'cancelled' THEN 'restaurant'::cancelled_by END,
             $6, 0, $7::numeric, $7::numeric,
             CASE WHEN $4 = 'delivery' THEN 'شارع الجامعة، بناية 12' END, $8::timestamptz)
     RETURNING id`,
    [
      restaurantId,
      customerId,
      nextNumber++,
      spec.fulfillment,
      spec.status,
      spec.cancellationReason ?? null,
      fee,
      spec.history[0]?.at ?? at(0),
    ],
  );
  const id = rows[0]!.id;
  for (const l of spec.lines) {
    await audit.query(
      `INSERT INTO order_items (order_id, restaurant_id, menu_item_id,
                                item_name_snapshot, unit_price_snapshot, quantity)
       VALUES ($1, $2, $3, $4, $5::numeric, $6)`,
      [id, restaurantId, l.item, l.name, l.price, l.quantity],
    );
  }
  await audit.query(
    `UPDATE orders
        SET subtotal = s.sum, total = s.sum + delivery_fee
       FROM (SELECT COALESCE(SUM(quantity * unit_price_snapshot), 0) AS sum
               FROM order_items WHERE order_id = $1) s
      WHERE id = $1`,
    [id],
  );
  // Written newest first on purpose, so an unordered read shows up.
  for (const h of [...spec.history].reverse()) {
    await audit.query(
      `INSERT INTO order_status_history (order_id, restaurant_id, from_status,
                                         to_status, actor, actor_staff_id, changed_at)
       VALUES ($1, $2, $3::order_status, $4::order_status, $5::actor_kind,
               CASE WHEN $5 = 'staff' THEN $6::uuid END, $7::timestamptz)`,
      [id, restaurantId, h.from, h.to, h.actor, staffTest, h.at],
    );
  }
  return id;
}

const token = (staffAccountId: string): string =>
  jwt.sign({ sub: staffAccountId, typ: "access" });

async function getOrder(
  id: string,
  opts: { staff?: string; restaurantId?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.staff !== undefined)
    headers["authorization"] = `Bearer ${token(opts.staff)}`;
  if (opts.restaurantId !== undefined)
    headers["x-restaurant-id"] = opts.restaurantId;
  return fetch(`${baseUrl}/orders/${id}`, { headers });
}

async function detailOk(
  id: string,
  staff: string,
  restaurant: string,
): Promise<OrderDetail> {
  const res = await getOrder(id, { staff, restaurantId: restaurant });
  expect(res.status).toBe(200);
  return (await res.json()) as OrderDetail;
}

async function expectNotFound(res: Response): Promise<void> {
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual(NOT_FOUND_BODY);
}

/** Test-side only: "12.05" → 1205, to check a sum without floats. */
const cents = (money: string): number => {
  const [whole, frac] = money.split(".");
  return Number(whole) * 100 + Number(frac);
};

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
  staffTest = await createStaff("d3");

  const r = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status)
     VALUES ($1, $2, 'active') RETURNING id`,
    [`مطعم ${RUN}`, `PHONE_${RUN}`],
  );
  restaurantId = r.rows[0]!.id;
  createdRestaurants.push(restaurantId);
  await addMember(staffTest, restaurantId);
  const c = await audit.query<{ id: string }>(
    `INSERT INTO customers (restaurant_id, phone_number, name)
     VALUES ($1, '+962791234567', NULL) RETURNING id`,
    [restaurantId],
  );
  customerId = c.rows[0]!.id;
  const cat = await audit.query<{ id: string }>(
    `INSERT INTO menu_categories (restaurant_id, name) VALUES ($1, 'مقبلات') RETURNING id`,
    [restaurantId],
  );
  const categoryId = cat.rows[0]!.id;
  await addMenuItem(categoryId, "شاورما دجاج", "2.50");
  await addMenuItem(categoryId, "حمص", "2.35");
  await addMenuItem(categoryId, "كنافة", "3.00");
  await addMenuItem(categoryId, "فلافل", "1.00");
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
// 🔴 Isolation — brief §2.9 and §8.1. Another restaurant's order is 404, with
//    the very body a non-existent id gets.
// ---------------------------------------------------------------------------
describe("GET /orders/:id — isolation", () => {
  it("an order of restaurant A requested by the staff of restaurant B is 404", async () => {
    await expectNotFound(
      await getOrder(SEED_ORDER_A, {
        staff: staffOnlyB,
        restaurantId: RESTAURANT_B,
      }),
    );
    // The same staff and header do reach their own order: the 404 above is
    // about whose order it is, not a broken route.
    expect((await detailOk(SEED_ORDER_B, staffOnlyB, RESTAURANT_B)).id).toBe(
      SEED_ORDER_B,
    );
  });

  it("B-only staff sending A's header is refused by the guard, with no order", async () => {
    const res = await getOrder(SEED_ORDER_A, {
      staff: staffOnlyB,
      restaurantId: RESTAURANT_A,
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["id"]).toBeUndefined();
    expect(body["items"]).toBeUndefined();
  });

  // 🔴 The caller is a member of both branches, so only the per-request
  //    context decides which of the two orders is visible.
  it("dual-branch staff reads A's order only under A's header, and B's only under B's", async () => {
    expect((await detailOk(SEED_ORDER_A, STAFF_BOTH, RESTAURANT_A)).id).toBe(
      SEED_ORDER_A,
    );
    await expectNotFound(
      await getOrder(SEED_ORDER_B, {
        staff: STAFF_BOTH,
        restaurantId: RESTAURANT_A,
      }),
    );

    expect((await detailOk(SEED_ORDER_B, STAFF_BOTH, RESTAURANT_B)).id).toBe(
      SEED_ORDER_B,
    );
    await expectNotFound(
      await getOrder(SEED_ORDER_A, {
        staff: STAFF_BOTH,
        restaurantId: RESTAURANT_B,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// The contract — brief §3.2.
// ---------------------------------------------------------------------------
describe("GET /orders/:id — contract", () => {
  it("a delivery order: lines from the snapshot, and total = Σ lineTotal + deliveryFee", async () => {
    const id = await createOrder({
      status: "preparing",
      fulfillment: "delivery",
      fee: "1.50",
      lines: [
        {
          item: menu["شاورما دجاج"]!,
          name: "شاورما دجاج",
          price: "2.50",
          quantity: 2,
        },
        { item: menu["حمص"]!, name: "حمص", price: "2.35", quantity: 3 },
      ],
      history: [
        { from: null, to: "pending_acceptance", actor: "customer", at: at(0) },
        {
          from: "pending_acceptance",
          to: "accepted",
          actor: "staff",
          at: at(2),
        },
        { from: "accepted", to: "preparing", actor: "staff", at: at(5) },
      ],
    });
    const { rows } = await audit.query<{ order_number: number }>(
      `SELECT order_number FROM orders WHERE id = $1`,
      [id],
    );

    const body = await detailOk(id, staffTest, restaurantId);

    expect(body).toEqual({
      id,
      orderNumber: rows[0]!.order_number,
      status: "preparing",
      fulfillmentType: "delivery",
      subtotal: "12.05",
      deliveryFee: "1.50",
      total: "13.55",
      paymentMethod: "cash",
      paymentStatus: "pending_cash",
      deliveryAddress: "شارع الجامعة، بناية 12",
      cancellationReason: null,
      createdAt: at(0),
      customer: { name: null, phone: "+962791234567" },
      items: [
        // 3 × 2.35 is 7.050000000000001 in a float: this line is computed in SQL.
        { name: "حمص", quantity: 3, unitPrice: "2.35", lineTotal: "7.05" },
        {
          name: "شاورما دجاج",
          quantity: 2,
          unitPrice: "2.50",
          lineTotal: "5.00",
        },
      ],
      history: [
        { from: null, to: "pending_acceptance", actor: "customer", at: at(0) },
        {
          from: "pending_acceptance",
          to: "accepted",
          actor: "staff",
          at: at(2),
        },
        { from: "accepted", to: "preparing", actor: "staff", at: at(5) },
      ],
    });
    const lines = body.items.reduce((sum, i) => sum + cents(i.lineTotal), 0);
    expect(lines).toBe(cents(body.subtotal));
    expect(lines + cents(body.deliveryFee)).toBe(cents(body.total));
  });

  it('a pickup order: deliveryFee is "0.00" and deliveryAddress is null', async () => {
    const id = await createOrder({
      status: "pending_acceptance",
      fulfillment: "pickup",
      lines: [
        { item: menu["كنافة"]!, name: "كنافة", price: "3.00", quantity: 1 },
      ],
      history: [
        { from: null, to: "pending_acceptance", actor: "customer", at: at(10) },
      ],
    });

    const body = await detailOk(id, staffTest, restaurantId);

    expect(body.fulfillmentType).toBe("pickup");
    expect(body.deliveryFee).toBe("0.00");
    expect(body.deliveryAddress).toBeNull();
    expect(body.subtotal).toBe("3.00");
    expect(body.total).toBe("3.00");
    expect(body.items).toEqual([
      { name: "كنافة", quantity: 1, unitPrice: "3.00", lineTotal: "3.00" },
    ]);
  });

  it("history is chronological and its first line is the customer's creation", async () => {
    const id = await createOrder({
      status: "ready",
      fulfillment: "pickup",
      lines: [
        { item: menu["كنافة"]!, name: "كنافة", price: "3.00", quantity: 2 },
      ],
      history: [
        { from: null, to: "pending_acceptance", actor: "customer", at: at(20) },
        {
          from: "pending_acceptance",
          to: "accepted",
          actor: "staff",
          at: at(21),
        },
        { from: "accepted", to: "preparing", actor: "staff", at: at(23) },
        { from: "preparing", to: "ready", actor: "staff", at: at(30) },
      ],
    });

    const body = await detailOk(id, staffTest, restaurantId);

    expect(body.history.map((h) => h.at)).toEqual([
      at(20),
      at(21),
      at(23),
      at(30),
    ]);
    expect(body.history[0]).toEqual({
      from: null,
      to: "pending_acceptance",
      actor: "customer",
      at: at(20),
    });
    expect(body.history.map((h) => h.to)).toEqual([
      "pending_acceptance",
      "accepted",
      "preparing",
      "ready",
    ]);
  });

  it("a cancelled order carries its reason; an order with no lines has items []", async () => {
    const id = await createOrder({
      status: "cancelled",
      fulfillment: "pickup",
      lines: [],
      history: [
        { from: null, to: "pending_acceptance", actor: "customer", at: at(40) },
        {
          from: "pending_acceptance",
          to: "cancelled",
          actor: "staff",
          at: at(41),
        },
      ],
      cancellationReason: "نفدت الكمية",
    });

    const body = await detailOk(id, staffTest, restaurantId);

    expect(body.status).toBe("cancelled");
    expect(body.cancellationReason).toBe("نفدت الكمية");
    expect(body.items).toEqual([]);
    expect(body.subtotal).toBe("0.00");
  });

  // 🔴 «السعر وعد»: the customer paid the old price, so the staff sees it.
  it("keeps the name and price of the moment of ordering after the menu changes", async () => {
    const id = await createOrder({
      status: "accepted",
      fulfillment: "pickup",
      lines: [
        { item: menu["فلافل"]!, name: "فلافل", price: "1.00", quantity: 4 },
      ],
      history: [
        { from: null, to: "pending_acceptance", actor: "customer", at: at(50) },
      ],
    });
    await audit.query(
      `UPDATE menu_items SET name = 'فلافل كبير', price = 1.75 WHERE id = $1`,
      [menu["فلافل"]],
    );

    const body = await detailOk(id, staffTest, restaurantId);

    expect(body.items).toEqual([
      { name: "فلافل", quantity: 4, unitPrice: "1.00", lineTotal: "4.00" },
    ]);
    expect(body.subtotal).toBe("4.00");
    expect(body.total).toBe("4.00");
  });
});

// ---------------------------------------------------------------------------
// Input — brief §3.2 and §8.7.
// ---------------------------------------------------------------------------
describe("GET /orders/:id — input", () => {
  it.each(["not-a-uuid", "123", "f0000000-0000-4000-8000-00000000000"])(
    "rejects an id that is not a UUID (%s) with 400",
    async (bad) => {
      const res = await getOrder(bad, {
        staff: STAFF_BOTH,
        restaurantId: RESTAURANT_A,
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body["statusCode"]).toBe(400);
      expect(body["message"]).toBe("Validation failed");
      expect(Array.isArray(body["errors"])).toBe(true);
    },
  );

  it("a well-formed id that belongs to no order is 404, same body as another restaurant's", async () => {
    await expectNotFound(
      await getOrder(NO_SUCH_ORDER, {
        staff: STAFF_BOTH,
        restaurantId: RESTAURANT_A,
      }),
    );
  });

  it("rejects a request without a token with 401", async () => {
    const res = await getOrder(SEED_ORDER_A, { restaurantId: RESTAURANT_A });
    expect(res.status).toBe(401);
  });
});
