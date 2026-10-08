/**
 * I-5 — `GET /orders/:id/messages` (brief I §4, §5 test 4): an order's
 * conversation, the customer's messages and the bot's, and which of them are
 * the order's.
 *
 * The harness of order-detail.test.ts: the real AppModule over real HTTP, as
 * `sufria_dashboard` with RLS live; fixtures written through
 * MIGRATION_DATABASE_URL, with times set by hand so the rules are tested at
 * their edges. Two restaurants of this suite's own, A and B.
 *
 * One customer of A, minute by minute (`at(m)`):
 *   -1500 «قديمة» and its reply — 25 hours before order 101: no order's
 *       0 «مرحبا» · 0.5 reply · 1 «1» · 1.5 reply
 *       3 «أكّد» — order 101 is made at that very moment · 3.2 «استلمنا 101»
 *       8 «مرحبا» · 8.5 two replies at the same instant · 9 an image (no text)
 *     9.2 a reply to the image · 10 «جاهز» naming order 101
 *      11 «أكّد» — order 102 · 11.2 «استلمنا 102»
 *      12 «شكرا» and its reply — after the last order: no order's yet
 * Another customer of A writes at minute 2; restaurant B has a customer with
 * the very same digits, who writes at minute 2 too.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import type { OrderMessage, OrderMessagesResponse } from "@sufria/shared";

import { AppModule } from "../src/app.module.js";

const RUN = `i5-${process.pid}-${Date.now()}`;
const BASE = Date.parse("2026-01-01T08:00:00.000Z");
const at = (minutes: number): string =>
  new Date(BASE + minutes * 60_000).toISOString();

const NOT_FOUND_BODY = { message: "Not Found", statusCode: 404 };
/** Well-formed, and belongs to no order anywhere. */
const NO_SUCH_ORDER = "f0000000-0000-4000-8000-0000000000fe";

const PHONE_1 = `9627${String(process.pid).padStart(8, "0").slice(-8)}`;
const PHONE_2 = `9707${String(process.pid).padStart(8, "0").slice(-8)}`;

let app: INestApplication;
let baseUrl: string;
let jwt: JwtService;
let audit: Pool;

const createdRestaurants: string[] = [];
const createdStaff: string[] = [];

let restaurantA = "";
let restaurantB = "";
let staffOnlyB = "";
let staffBoth = "";
let order101 = "";
let order102 = "";
let orderQuiet = "";
let nextNumber = 101;
let wamid = 0;

/** Every message written, by name, with its id and time. */
const msg: Record<string, { id: string; at: string }> = {};

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

async function createRestaurant(label: string): Promise<string> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status)
     VALUES ($1, $2, 'active') RETURNING id`,
    [`مطعم ${label} ${RUN}`, `PHONE_${label}_${RUN}`],
  );
  const id = rows[0]!.id;
  createdRestaurants.push(id);
  return id;
}

async function createCustomer(
  restaurant: string,
  phone: string,
): Promise<string> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO customers (restaurant_id, phone_number) VALUES ($1, $2) RETURNING id`,
    [restaurant, phone],
  );
  return rows[0]!.id;
}

/** An order made at minute `m` — `created_at`, as the engine's transaction stamps it. */
async function createOrder(
  restaurant: string,
  customer: string,
  m: number,
): Promise<string> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO orders (restaurant_id, customer_id, order_number, fulfillment_type,
                         payment_method, status, payment_status, subtotal,
                         delivery_fee, total, created_at)
     VALUES ($1, $2, $3, 'pickup', 'cash', 'pending_acceptance', 'pending_cash',
             5.00, 0, 5.00, $4::timestamptz)
     RETURNING id`,
    [restaurant, customer, nextNumber++, at(m)],
  );
  return rows[0]!.id;
}

/** A customer's message, received at minute `m`; `text: null` is an image. */
async function inbound(
  name: string,
  restaurant: string,
  phone: string,
  m: number,
  text: string | null,
): Promise<void> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO inbound_messages (restaurant_id, wa_message_id, phone_number_id,
                                   from_phone, message_type, body, payload,
                                   sent_at, received_at)
     VALUES ($1, $2, 'PHONE_TEST', $3, $4, $5, '{}'::jsonb, $6::timestamptz, $6::timestamptz)
     RETURNING id`,
    [
      restaurant,
      `wamid.${RUN}.${++wamid}`,
      phone,
      text === null ? "image" : "text",
      text,
      at(m),
    ],
  );
  msg[name] = { id: rows[0]!.id, at: at(m) };
}

/** A message the bot sent at minute `m`, naming `orderId` or none. */
async function outbound(
  name: string,
  restaurant: string,
  phone: string,
  m: number,
  text: string,
  orderId: string | null = null,
): Promise<void> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO outbound_messages (restaurant_id, to_phone, body, order_id, sent_at)
     VALUES ($1, $2, $3, $4, $5::timestamptz)
     RETURNING id`,
    [restaurant, phone, text, orderId, at(m)],
  );
  msg[name] = { id: rows[0]!.id, at: at(m) };
}

const token = (staffAccountId: string): string =>
  jwt.sign({ sub: staffAccountId, typ: "access" });

async function getMessages(
  id: string,
  opts: { staff?: string; restaurantId?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.staff !== undefined)
    headers["authorization"] = `Bearer ${token(opts.staff)}`;
  if (opts.restaurantId !== undefined)
    headers["x-restaurant-id"] = opts.restaurantId;
  return fetch(`${baseUrl}/orders/${id}/messages`, { headers });
}

async function messagesOk(
  id: string,
  staff = staffBoth,
  restaurant = restaurantA,
): Promise<OrderMessage[]> {
  const res = await getMessages(id, { staff, restaurantId: restaurant });
  expect(res.status).toBe(200);
  return ((await res.json()) as OrderMessagesResponse).messages;
}

/** The names of the messages a reply holds, in its order. */
function named(messages: OrderMessage[]): string[] {
  const byId = new Map(Object.entries(msg).map(([name, m]) => [m.id, name]));
  return messages.map((m) => byId.get(m.id) ?? `unknown:${m.id}`);
}

/** The two replies at minute 8.5, in `id` order — the tie-break. */
const tie = (): string[] =>
  ["reply-8.5-a", "reply-8.5-b"].sort((a, b) =>
    msg[a]!.id < msg[b]!.id ? -1 : 1,
  );

const EXPECTED_101 = [
  "hello-0",
  "reply-0.5",
  "one-1",
  "reply-1.5",
  "confirm-3",
  "received-101",
  "ready-101",
];
const EXPECTED_102 = (): string[] => [
  "hello-8",
  ...tie(),
  "reply-to-image",
  "confirm-11",
  "received-102",
];

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

  restaurantA = await createRestaurant("i5-a");
  restaurantB = await createRestaurant("i5-b");
  staffOnlyB = await createStaff("i5-only-b");
  await addMember(staffOnlyB, restaurantB);
  staffBoth = await createStaff("i5-both");
  await addMember(staffBoth, restaurantA);
  await addMember(staffBoth, restaurantB);

  const customer = await createCustomer(restaurantA, PHONE_1);
  await createCustomer(restaurantA, PHONE_2);
  await createCustomer(restaurantB, PHONE_1);

  await inbound("old", restaurantA, PHONE_1, -1500, "قديمة");
  await outbound("old-reply", restaurantA, PHONE_1, -1499.5, "رد قديم");
  await inbound("hello-0", restaurantA, PHONE_1, 0, "مرحبا");
  await outbound("reply-0.5", restaurantA, PHONE_1, 0.5, "أهلا بك في المطعم.");
  await inbound("one-1", restaurantA, PHONE_1, 1, "1");
  await outbound("reply-1.5", restaurantA, PHONE_1, 1.5, "أضفت: شاورما ×1");
  await inbound("confirm-3", restaurantA, PHONE_1, 3, "أكّد");
  order101 = await createOrder(restaurantA, customer, 3);
  // Sent after the order's transaction, naming none — the engine never does.
  await outbound(
    "received-101",
    restaurantA,
    PHONE_1,
    3.2,
    "استلمنا طلبك رقم 101",
  );

  await inbound("hello-8", restaurantA, PHONE_1, 8, "مرحبا");
  await outbound(
    "reply-8.5-a",
    restaurantA,
    PHONE_1,
    8.5,
    "أهلا بك في المطعم.",
  );
  await outbound("reply-8.5-b", restaurantA, PHONE_1, 8.5, "القائمة");
  await inbound("image-9", restaurantA, PHONE_1, 9, null);
  await outbound(
    "reply-to-image",
    restaurantA,
    PHONE_1,
    9.2,
    "الطلب بالأرقام فقط.",
  );
  await outbound(
    "ready-101",
    restaurantA,
    PHONE_1,
    10,
    "طلبك جاهز للاستلام.",
    order101,
  );
  await inbound("confirm-11", restaurantA, PHONE_1, 11, "أكّد");
  order102 = await createOrder(restaurantA, customer, 11);
  await outbound(
    "received-102",
    restaurantA,
    PHONE_1,
    11.2,
    "استلمنا طلبك رقم 102",
  );
  await inbound("thanks-12", restaurantA, PHONE_1, 12, "شكرا");
  await outbound("reply-12.5", restaurantA, PHONE_1, 12.5, "عفوا");

  await inbound("other-2", restaurantA, PHONE_2, 2, "مرحبا");
  await outbound(
    "other-reply",
    restaurantA,
    PHONE_2,
    2.5,
    "أهلا بك في المطعم.",
  );
  await inbound("same-digits-at-b", restaurantB, PHONE_1, 2, "مرحبا من فرع ب");

  const quiet = await createCustomer(restaurantA, `${PHONE_2}9`);
  orderQuiet = await createOrder(restaurantA, quiet, 20);
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

describe("GET /orders/:id/messages — isolation", () => {
  it("🔴 B's staff asking for A's order: 404, and not one message", async () => {
    const res = await getMessages(order101, {
      staff: staffOnlyB,
      restaurantId: restaurantB,
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND_BODY);
  });

  it("🔴 a staff member of both branches, under A's header: A's order's messages, and A's alone", async () => {
    expect(named(await messagesOk(order101, staffBoth, restaurantA))).toEqual(
      EXPECTED_101,
    );
    // The very order under B's header is not there at all.
    const res = await getMessages(order101, {
      staff: staffBoth,
      restaurantId: restaurantB,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND_BODY);
  });
});

describe("GET /orders/:id/messages — which messages are the order's", () => {
  it("two orders of one customer, one after the other: every message in exactly one", async () => {
    const first = named(await messagesOk(order101));
    const second = named(await messagesOk(order102));

    expect(first).toEqual(EXPECTED_101);
    expect(second).toEqual(EXPECTED_102());
    expect(first.filter((name) => second.includes(name))).toEqual([]);
  });

  it("🔴 the «ready» of 101, sent while the customer is mid-conversation for 102, is 101's alone", async () => {
    expect(named(await messagesOk(order101))).toContain("ready-101");
    expect(named(await messagesOk(order102))).not.toContain("ready-101");
  });

  it("🔴 another customer of the same restaurant: none of their messages", async () => {
    const all = [
      ...named(await messagesOk(order101)),
      ...named(await messagesOk(order102)),
    ];
    expect(all).not.toContain("other-2");
    expect(all).not.toContain("other-reply");
    expect(all).not.toContain("same-digits-at-b");
  });

  it("the edges: older than 24 hours, after the last order, an image — no order's; the reply to the image is", async () => {
    const all = [
      ...named(await messagesOk(order101)),
      ...named(await messagesOk(order102)),
    ];
    for (const none of [
      "old",
      "old-reply",
      "thanks-12",
      "reply-12.5",
      "image-9",
    ])
      expect(all).not.toContain(none);
    expect(named(await messagesOk(order102))).toContain("reply-to-image");
  });

  it("an order with no messages kept: 200, an empty list — not a 404", async () => {
    expect(await messagesOk(orderQuiet)).toEqual([]);
  });
});

describe("GET /orders/:id/messages — the reply", () => {
  it("time order, then id; each message's direction, text and time as ISO in UTC", async () => {
    const messages = await messagesOk(order102);

    expect(named(messages)).toEqual(EXPECTED_102());
    const keys = messages.map((m) => `${m.at}|${m.id}`);
    expect(keys).toEqual([...keys].sort());
    expect(messages[0]).toEqual({
      id: msg["hello-8"]!.id,
      direction: "inbound",
      text: "مرحبا",
      at: at(8),
    });
    expect(messages.at(-1)).toEqual({
      id: msg["received-102"]!.id,
      direction: "outbound",
      text: "استلمنا طلبك رقم 102",
      at: at(11.2),
    });
  });

  it("an id that is not a UUID is 400", async () => {
    const res = await getMessages("not-a-uuid", {
      staff: staffBoth,
      restaurantId: restaurantA,
    });
    expect(res.status).toBe(400);
  });

  it("no token is 401", async () => {
    const res = await getMessages(order101, { restaurantId: restaurantA });
    expect(res.status).toBe(401);
  });

  it("an id that belongs to no order is 404", async () => {
    const res = await getMessages(NO_SUCH_ORDER, {
      staff: staffBoth,
      restaurantId: restaurantA,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND_BODY);
  });
});
