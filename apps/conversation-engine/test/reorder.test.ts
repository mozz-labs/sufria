/**
 * ka-3 · «آخر طلب لك» and «نفسه» — brief ك §5, on a real database.
 *
 * The orders a returning customer has are written straight to the tables from
 * the audit connection, their age by `created_at = now() - interval` (as brief
 * ح ages a session): the suggestion reads what is there, however it got there.
 * Every reply is read off the recording sender; every expected block is
 * written out by hand.
 *
 * The cases are numbered as in the brief's table; what is added past it says
 * so in its name.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import {
  ADDRESS_ASK_AR,
  CLOSED_AR,
  CONFIRM_PROMPT_AR,
  ORDERS_PAUSED_AR,
  fulfillmentAskAr,
  nothingUnderstoodAr,
  type Currency,
} from "@sufria/shared";

import {
  ConversationService,
  flushDeferred,
  type ConversationOutcome,
  type DeferredSend,
} from "../src/conversation/session.service.js";
import { TenantDb } from "../src/db/tenant-db.js";
import { RecordingWhatsAppSender } from "../src/whatsapp/sender.js";

const RUN = randomUUID();

let customerSeq = 0;
const nextCustomer = (): string =>
  `96278${String(++customerSeq).padStart(7, "0")}`;

/** `{}` = always open. */
const ALWAYS_OPEN_HOURS = {};
/** No open day at all — «closed» without depending on the clock. */
const ALWAYS_CLOSED_HOURS = {
  days: { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] },
};

/** Two categories; the menu numbers are 1–6 in this order. */
const MENU = [
  {
    name: "سندويشات",
    items: [
      { name: "شاورما دجاج", price: "15.00" },
      { name: "شاورما لحمة", price: "20.00" },
      { name: "فلافل", price: "5.00" },
    ],
  },
  {
    name: "جانبي",
    items: [
      { name: "بطاطا", price: "8.00" },
      { name: "حمّص", price: "7.00" },
      { name: "مشروب", price: "4.00" },
    ],
  },
];

let db: TenantDb;
let audit: Pool;
let replies: RecordingWhatsAppSender;
let conversation: ConversationService;
const createdRestaurants: string[] = [];

interface Shop {
  id: string;
  pid: string;
  /** item name → id */
  ids: Record<string, string>;
  /** category name → id */
  categories: Record<string, string>;
  nextOrderNumber: number;
}

async function shop(
  label: string,
  opts: {
    offersDelivery?: boolean;
    deliveryFee?: string;
    currency?: Currency;
    name?: string;
    menu?: { name: string; items: { name: string; price: string }[] }[];
  } = {},
): Promise<Shop> {
  const pid = `PHONE.REORDER.${RUN}.${label}`;
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status, business_hours,
                              offers_delivery, delivery_fee, currency)
     VALUES ($1, $2, 'active'::restaurant_status, $3::jsonb, $4, $5, $6)
     RETURNING id`,
    [
      opts.name ?? `مطعم ${label}`,
      pid,
      JSON.stringify(ALWAYS_OPEN_HOURS),
      opts.offersDelivery ?? false,
      opts.deliveryFee ?? "0",
      opts.currency ?? "JOD",
    ],
  );
  const id = rows[0]?.id ?? "";
  createdRestaurants.push(id);

  const ids: Record<string, string> = {};
  const categories: Record<string, string> = {};
  for (const [c, category] of (opts.menu ?? MENU).entries()) {
    const cat = await audit.query<{ id: string }>(
      `INSERT INTO menu_categories (restaurant_id, name, display_order)
       VALUES ($1, $2, $3) RETURNING id`,
      [id, category.name, c],
    );
    categories[category.name] = cat.rows[0]?.id ?? "";
    for (const [i, item] of category.items.entries()) {
      const r = await audit.query<{ id: string }>(
        `INSERT INTO menu_items (restaurant_id, category_id, name, price, display_order)
         VALUES ($1, $2, $3, $4::numeric, $5) RETURNING id`,
        [id, cat.rows[0]?.id, item.name, item.price, i],
      );
      ids[item.name] = r.rows[0]?.id ?? "";
    }
  }
  return { id, pid, ids, categories, nextOrderNumber: 101 };
}

type Status =
  | "pending_acceptance"
  | "accepted"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled"
  | "expired";

/**
 * A past order of `from` at `s`, `ageMinutes` old by the database's clock.
 * A line names a menu item (its price today unless `price` says otherwise),
 * or carries `menuItemId: null` — a row deleted since.
 */
async function pastOrder(
  s: Shop,
  from: string,
  spec: {
    status: Status;
    ageMinutes: number;
    lines: { item: string; qty: number; price?: string; nullItem?: true }[];
  },
): Promise<string> {
  const customer = await audit.query<{ id: string }>(
    `INSERT INTO customers (restaurant_id, phone_number) VALUES ($1, $2)
     ON CONFLICT (restaurant_id, phone_number) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [s.id, from],
  );
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO orders (restaurant_id, customer_id, order_number, fulfillment_type,
                         payment_method, status, payment_status, cancelled_by,
                         notified, subtotal, total, created_at, updated_at)
     VALUES ($1, $2, $3, 'pickup', 'cash', $4::order_status,
             CASE WHEN $4 = 'completed' THEN 'collected' ELSE 'pending_cash' END::payment_status,
             CASE WHEN $4 = 'cancelled' THEN 'restaurant'::cancelled_by END,
             true, 10.00, 10.00,
             now() - make_interval(mins => $5), now() - make_interval(mins => $5))
     RETURNING id`,
    [
      s.id,
      customer.rows[0]?.id,
      s.nextOrderNumber++,
      spec.status,
      spec.ageMinutes,
    ],
  );
  const orderId = rows[0]?.id ?? "";
  for (const line of spec.lines) {
    const itemId = line.nullItem ? null : (s.ids[line.item] ?? null);
    const today = await audit.query<{ price: string }>(
      `SELECT price::text AS price FROM menu_items WHERE id = $1`,
      [itemId],
    );
    await audit.query(
      `INSERT INTO order_items (order_id, restaurant_id, menu_item_id,
                                item_name_snapshot, unit_price_snapshot, quantity)
       VALUES ($1, $2, $3, $4, $5::numeric, $6)`,
      [
        orderId,
        s.id,
        itemId,
        line.item,
        line.price ?? today.rows[0]?.price ?? "1.00",
        line.qty,
      ],
    );
  }
  return orderId;
}

interface Customer {
  from: string;
  /** Sends one message; returns the outcome. */
  say: (body: string | null) => Promise<ConversationOutcome>;
  /** The replies to this customer since the last `say`. */
  sent: () => string[];
  /** The one reply to the last `say`. */
  reply: () => string;
  context: () => Promise<Record<string, unknown>>;
  state: () => Promise<string>;
  sessions: () => Promise<number>;
}

function customer(
  s: Shop,
  from = nextCustomer(),
  service: () => ConversationService = () => conversation,
): Customer {
  const sent = (): string[] =>
    replies
      .forRestaurant(s.id)
      .filter((m) => m.to === from)
      .map((m) => m.body);
  const latest = async (): Promise<{
    state: string;
    context: Record<string, unknown>;
  } | null> => {
    const { rows } = await audit.query<{
      state: string;
      context: Record<string, unknown>;
    }>(
      `SELECT s.state::text AS state, s.context FROM conversation_sessions s
         JOIN customers c ON c.id = s.customer_id
        WHERE s.restaurant_id = $1 AND c.phone_number = $2
        ORDER BY s.created_at DESC, s.id DESC LIMIT 1`,
      [s.id, from],
    );
    return rows[0] ?? null;
  };
  return {
    from,
    say: async (body) => {
      replies.reset();
      const deferred: DeferredSend[] = [];
      const svc = service();
      const outcome = await db.runInTenant(s.id, (tx) =>
        svc.handleInbound(tx, {
          restaurantId: s.id,
          phoneNumberId: s.pid,
          from,
          body,
          deferred,
        }),
      );
      await flushDeferred(svc.sender, deferred);
      return outcome;
    },
    sent,
    reply: () => {
      const all = sent();
      expect(all).toHaveLength(1);
      return all[0] ?? "";
    },
    context: async () => (await latest())?.context ?? {},
    state: async () => (await latest())?.state ?? "",
    sessions: async () => {
      const { rows } = await audit.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM conversation_sessions s
           JOIN customers c ON c.id = s.customer_id
          WHERE s.restaurant_id = $1 AND c.phone_number = $2`,
        [s.id, from],
      );
      return rows[0]?.n ?? 0;
    },
  };
}

/** A new customer's first message at `s` — what everyone without a suggestion gets. */
async function plainFirstMessage(s: Shop): Promise<string> {
  const c = customer(s);
  expect(await c.say("مرحبا")).toBe("greeted");
  return c.reply();
}

/** The plain first message with `block` between the welcome and the menu. */
function withBlock(plain: string, block: string): string {
  const cut = plain.indexOf("\n");
  return `${plain.slice(0, cut)}\n\n${block}\n\n${plain.slice(cut + 1)}`;
}

const HOURS = 60;

beforeAll(async () => {
  const url = process.env["MIGRATION_DATABASE_URL"];
  if (!url)
    throw new Error("MIGRATION_DATABASE_URL is missing — see .env.example");
  audit = new Pool({ connectionString: url, max: 3 });
  db = new TenantDb();
  await db.start();
  replies = new RecordingWhatsAppSender();
  conversation = new ConversationService(replies);
});

afterEach(() => {
  replies.reset();
});

afterAll(async () => {
  await db.stop();
  if (createdRestaurants.length > 0) {
    // The cascade takes the menu, customers, sessions, orders and lines along.
    await audit.query("DELETE FROM restaurants WHERE id = ANY($1::uuid[])", [
      createdRestaurants,
    ]);
  }
  await audit.end();
});

// ---------------------------------------------------------------------------
// The first message
// ---------------------------------------------------------------------------

describe("«آخر طلب لك» in the first message", () => {
  it("1. last order accepted 4 hours ago → the block, to the letter, and context.reorder kept", async () => {
    const s = await shop("k1");
    const plain = await plainFirstMessage(s);
    const c = customer(s);
    // Inserted out of menu order: the block follows today's menu, not the rows.
    const orderId = await pastOrder(s, c.from, {
      status: "accepted",
      ageMinutes: 4 * HOURS,
      lines: [
        { item: "بطاطا", qty: 1 },
        { item: "شاورما دجاج", qty: 2 },
      ],
    });

    expect(await c.say("مرحبا")).toBe("greeted");
    expect(c.reply()).toBe(
      withBlock(
        plain,
        "آخر طلب لك:\n" +
          "شاورما دجاج ×2 — 30.00 د.أ\n" +
          "بطاطا ×1 — 8.00 د.أ\n" +
          "المجموع 38.00 د.أ\n" +
          "اكتب «نفسه» لتكرار الطلب.",
      ),
    );
    expect((await c.context())["reorder"]).toEqual({
      order_id: orderId,
      items: [
        { item_id: s.ids["شاورما دجاج"], name: "شاورما دجاج", qty: 2 },
        { item_id: s.ids["بطاطا"], name: "بطاطا", qty: 1 },
      ],
    });
  });

  it("1b (past the table). one item on two lines: the quantities add up, and stop at 50", async () => {
    const s = await shop("k1b");
    const plain = await plainFirstMessage(s);
    const c = customer(s);
    await pastOrder(s, c.from, {
      status: "completed",
      ageMinutes: 30 * HOURS,
      lines: [
        { item: "فلافل", qty: 30 },
        { item: "فلافل", qty: 30 },
        { item: "مشروب", qty: 1 },
        { item: "مشروب", qty: 2 },
      ],
    });

    await c.say("مرحبا");
    expect(c.reply()).toBe(
      withBlock(
        plain,
        "آخر طلب لك:\n" +
          "فلافل ×50 — 250.00 د.أ\n" +
          "مشروب ×3 — 12.00 د.أ\n" +
          "المجموع 262.00 د.أ\n" +
          "اكتب «نفسه» لتكرار الطلب.",
      ),
    );
  });

  it("2. a new customer → no block: demo.json's first message, the existing snapshot to the letter", async () => {
    const demo = JSON.parse(
      readFileSync(
        resolve(__dirname, "../../../db/restaurants/demo.json"),
        "utf8",
      ),
    ) as {
      name: string;
      currency: Currency;
      menu: { name: string; items: { name: string; price: string }[] }[];
    };
    const s = await shop("k2", {
      name: demo.name,
      currency: demo.currency,
      menu: demo.menu,
    });
    const c = customer(s);

    expect(await c.say("مرحبا")).toBe("greeted");
    expect(c.reply()).toBe(
      readFileSync(
        resolve(__dirname, "fixtures/menu-snapshot/demo-first.txt"),
        "utf8",
      ),
    );
    expect((await c.context())["reorder"]).toBeUndefined();
  });

  it("3. last order cancelled, the one before completed → the suggestion is the completed one", async () => {
    const s = await shop("k3");
    const plain = await plainFirstMessage(s);
    const c = customer(s);
    const completed = await pastOrder(s, c.from, {
      status: "completed",
      ageMinutes: 24 * HOURS,
      lines: [{ item: "حمّص", qty: 2 }],
    });
    // Cancelled half an hour ago: neither the suggestion nor decision 3's
    // three hours count it.
    await pastOrder(s, c.from, {
      status: "cancelled",
      ageMinutes: 30,
      lines: [{ item: "شاورما لحمة", qty: 1 }],
    });

    await c.say("مرحبا");
    expect(c.reply()).toBe(
      withBlock(
        plain,
        "آخر طلب لك:\n" +
          "حمّص ×2 — 14.00 د.أ\n" +
          "المجموع 14.00 د.أ\n" +
          "اكتب «نفسه» لتكرار الطلب.",
      ),
    );
    expect(
      ((await c.context())["reorder"] as { order_id: string }).order_id,
    ).toBe(completed);
  });

  it("4. only an old pending_acceptance order → no suggestion", async () => {
    const s = await shop("k4");
    const plain = await plainFirstMessage(s);
    const c = customer(s);
    await pastOrder(s, c.from, {
      status: "pending_acceptance",
      ageMinutes: 24 * HOURS,
      lines: [{ item: "فلافل", qty: 1 }],
    });

    await c.say("مرحبا");
    expect(c.reply()).toBe(plain);
    expect((await c.context())["reorder"]).toBeUndefined();
  });

  it("5. an order accepted 2 hours ago (and one yesterday) → no suggestion (decision 3)", async () => {
    const s = await shop("k5");
    const plain = await plainFirstMessage(s);
    const c = customer(s);
    await pastOrder(s, c.from, {
      status: "completed",
      ageMinutes: 24 * HOURS,
      lines: [{ item: "فلافل", qty: 1 }],
    });
    await pastOrder(s, c.from, {
      status: "accepted",
      ageMinutes: 2 * HOURS,
      lines: [{ item: "بطاطا", qty: 1 }],
    });

    await c.say("مرحبا");
    expect(c.reply()).toBe(plain);
    expect((await c.context())["reorder"]).toBeUndefined();
  });

  it("6. pending_acceptance 10 minutes ago, completed yesterday → no suggestion", async () => {
    const s = await shop("k6");
    const plain = await plainFirstMessage(s);
    const c = customer(s);
    await pastOrder(s, c.from, {
      status: "completed",
      ageMinutes: 24 * HOURS,
      lines: [{ item: "فلافل", qty: 1 }],
    });
    await pastOrder(s, c.from, {
      status: "pending_acceptance",
      ageMinutes: 10,
      lines: [{ item: "بطاطا", qty: 1 }],
    });

    await c.say("مرحبا");
    expect(c.reply()).toBe(plain);
  });

  it("7. switched off, archived, in a switched-off category, and a NULL line → the rest, and «غير متوفر الآن» for the three that exist", async () => {
    const s = await shop("k7", {
      menu: [
        ...MENU,
        { name: "حلويات", items: [{ name: "كنافة", price: "6.00" }] },
      ],
    });
    const c = customer(s);
    await pastOrder(s, c.from, {
      status: "completed",
      ageMinutes: 24 * HOURS,
      lines: [
        { item: "شاورما لحمة", qty: 1 },
        { item: "بطاطا", qty: 2 },
        { item: "حمّص", qty: 1 },
        { item: "كنافة", qty: 1 },
        { item: "صنف انمسح", qty: 3, nullItem: true },
      ],
    });
    await audit.query(
      `UPDATE menu_items SET is_available = false WHERE id = $1`,
      [s.ids["بطاطا"]],
    );
    await audit.query(
      `UPDATE menu_items SET is_available = false, archived_at = now() WHERE id = $1`,
      [s.ids["حمّص"]],
    );
    await audit.query(
      `UPDATE menu_categories SET is_active = false WHERE id = $1`,
      [s.categories["حلويات"]],
    );
    const plain = await plainFirstMessage(s);

    await c.say("مرحبا");
    expect(c.reply()).toBe(
      withBlock(
        plain,
        "آخر طلب لك:\n" +
          "شاورما لحمة ×1 — 20.00 د.أ\n" +
          "المجموع 20.00 د.أ\n" +
          "الأصناف بطاطا، حمّص، كنافة غير متوفرة الآن.\n" +
          "اكتب «نفسه» لتكرار الطلب.",
      ),
    );
    expect(
      ((await c.context())["reorder"] as { items: unknown[] }).items,
    ).toEqual([{ item_id: s.ids["شاورما لحمة"], name: "شاورما لحمة", qty: 1 }]);
  });

  it("8. every item of the order switched off → no suggestion at all, the plain first message", async () => {
    const s = await shop("k8");
    const c = customer(s);
    await pastOrder(s, c.from, {
      status: "completed",
      ageMinutes: 24 * HOURS,
      lines: [
        { item: "بطاطا", qty: 1 },
        { item: "حمّص", qty: 1 },
      ],
    });
    await audit.query(
      `UPDATE menu_items SET is_available = false WHERE id = ANY($1::uuid[])`,
      [[s.ids["بطاطا"], s.ids["حمّص"]]],
    );
    const plain = await plainFirstMessage(s);

    expect(await c.say("مرحبا")).toBe("greeted");
    expect(c.reply()).toBe(plain);
    expect((await c.context())["reorder"]).toBeUndefined();
  });

  it("9. the price changed since the order → today's price in the line and the total", async () => {
    const s = await shop("k9");
    const plain = await plainFirstMessage(s);
    const c = customer(s);
    await pastOrder(s, c.from, {
      status: "completed",
      ageMinutes: 24 * HOURS,
      lines: [
        { item: "شاورما دجاج", qty: 2, price: "12.00" },
        { item: "مشروب", qty: 1, price: "3.25" },
      ],
    });

    await c.say("مرحبا");
    expect(c.reply()).toBe(
      withBlock(
        plain,
        "آخر طلب لك:\n" +
          "شاورما دجاج ×2 — 30.00 د.أ\n" +
          "مشروب ×1 — 4.00 د.أ\n" +
          "المجموع 34.00 د.أ\n" +
          "اكتب «نفسه» لتكرار الطلب.",
      ),
    );
  });

  it("16. a menu near the limit: > 4096 with the block, ≤ 4096 without → the plain first message, no context.reorder", async () => {
    const s = await shop("k16");
    const c = customer(s);
    await pastOrder(s, c.from, {
      status: "completed",
      ageMinutes: 24 * HOURS,
      lines: [{ item: "شاورما دجاج", qty: 1 }],
    });
    // Pad a category name until the plain first message is 4090 characters:
    // it fits; the block (well over six characters) does not.
    const before = [...(await plainFirstMessage(s))].length;
    await audit.query(
      `UPDATE menu_categories SET name = name || repeat('ا', $2) WHERE id = $1`,
      [s.categories["جانبي"], 4090 - before],
    );
    const plain = await plainFirstMessage(s);
    expect([...plain].length).toBe(4090);

    expect(await c.say("مرحبا")).toBe("greeted");
    expect(c.reply()).toBe(plain);
    expect((await c.context())["reorder"]).toBeUndefined();
  });

  it("17. the same number is a customer with an accepted order at another restaurant → no suggestion here", async () => {
    const here = await shop("k17-here");
    const there = await shop("k17-there");
    const plain = await plainFirstMessage(here);
    const from = nextCustomer();
    await pastOrder(there, from, {
      status: "completed",
      ageMinutes: 24 * HOURS,
      lines: [{ item: "فلافل", qty: 1 }],
    });
    const c = customer(here, from);

    await c.say("مرحبا");
    expect(c.reply()).toBe(plain);
    expect((await c.context())["reorder"]).toBeUndefined();
  });

  it("18. orders paused, or the restaurant closed → that text alone, and no session", async () => {
    const paused = await shop("k18-paused");
    const closed = await shop("k18-closed");
    await audit.query(
      `UPDATE restaurants SET orders_paused_at = now() WHERE id = $1`,
      [paused.id],
    );
    await audit.query(
      `UPDATE restaurants SET business_hours = $2::jsonb WHERE id = $1`,
      [closed.id, JSON.stringify(ALWAYS_CLOSED_HOURS)],
    );
    for (const [s, outcome, text] of [
      [paused, "orders_paused", ORDERS_PAUSED_AR],
      [closed, "closed", CLOSED_AR],
    ] as const) {
      const c = customer(s);
      await pastOrder(s, c.from, {
        status: "completed",
        ageMinutes: 24 * HOURS,
        lines: [{ item: "فلافل", qty: 1 }],
      });
      expect(await c.say("مرحبا")).toBe(outcome);
      expect(c.reply()).toBe(text);
      expect(await c.sessions()).toBe(0);
    }
  });

  it("19. «منيو» after the welcome → the menu alone, no block; context.reorder stays", async () => {
    const s = await shop("k19");
    const c = customer(s);
    await pastOrder(s, c.from, {
      status: "completed",
      ageMinutes: 24 * HOURS,
      lines: [{ item: "فلافل", qty: 1 }],
    });
    const plain = await plainFirstMessage(s);
    await c.say("مرحبا");
    const kept = (await c.context())["reorder"];
    expect(kept).toBeDefined();

    expect(await c.say("منيو")).toBe("browsing");
    // The plain first message without its welcome line is the menu alone.
    expect(c.reply()).toBe(plain.slice(plain.indexOf("\n") + 1));
    expect((await c.context())["reorder"]).toEqual(kept);
  });
});

// ---------------------------------------------------------------------------
// «نفسه»
// ---------------------------------------------------------------------------

/** A greeted returning customer, at `s`, whose last order was these lines. */
async function returning(
  s: Shop,
  lines: { item: string; qty: number; price?: string }[],
): Promise<Customer> {
  const c = customer(s);
  await pastOrder(s, c.from, {
    status: "completed",
    ageMinutes: 24 * HOURS,
    lines,
  });
  expect(await c.say("مرحبا")).toBe("greeted");
  expect(c.reply()).toContain("آخر طلب لك:");
  return c;
}

interface CartRow {
  item_id: string;
  name: string;
  unit_price_minor: number;
  qty: number;
}
const cartOf = async (c: Customer): Promise<CartRow[]> =>
  ((await c.context())["cart"] as CartRow[]) ?? [];

describe("«نفسه»", () => {
  it("10. at a restaurant that delivers → the cart at today's prices, fulfillment_choice and the fee question", async () => {
    const s = await shop("k10", { offersDelivery: true, deliveryFee: "1.50" });
    const c = await returning(s, [
      { item: "شاورما دجاج", qty: 2, price: "12.00" },
      { item: "بطاطا", qty: 1, price: "6.00" },
    ]);

    expect(await c.say("نفسه")).toBe("browsing");
    expect(c.reply()).toBe(fulfillmentAskAr(150, "JOD"));
    expect(await c.state()).toBe("fulfillment_choice");
    expect(await cartOf(c)).toEqual([
      {
        item_id: s.ids["شاورما دجاج"],
        name: "شاورما دجاج",
        unit_price_minor: 1500,
        qty: 2,
      },
      { item_id: s.ids["بطاطا"], name: "بطاطا", unit_price_minor: 800, qty: 1 },
    ]);
  });

  it("11. at a pickup-only restaurant → cart_review and the summary", async () => {
    const s = await shop("k11");
    const c = await returning(s, [
      { item: "شاورما دجاج", qty: 2 },
      { item: "بطاطا", qty: 1 },
    ]);

    await c.say("نفسه");
    expect(c.reply()).toBe(
      "ملخّص طلبك:\n" +
        "1 · شاورما دجاج ×2 — 30.00 د.أ\n" +
        "4 · بطاطا ×1 — 8.00 د.أ\n" +
        "المجموع 38.00 د.أ\n" +
        "الاستلام من المطعم\n" +
        "الدفع نقدا.\n" +
        "اكتب «أكّد» لإرسال الطلب، أو «عدّل» أو «ألغِ».",
    );
    expect(await c.state()).toBe("cart_review");
  });

  it("12. «نفسو» and «نفس الطلب» → as 10", async () => {
    for (const word of ["نفسو", "نفس الطلب"]) {
      const s = await shop(`k12-${word}`, {
        offersDelivery: true,
        deliveryFee: "1.50",
      });
      const c = await returning(s, [{ item: "شاورما دجاج", qty: 2 }]);

      await c.say(word);
      expect(c.reply()).toBe(fulfillmentAskAr(150, "JOD"));
      expect(await c.state()).toBe("fulfillment_choice");
      expect(await cartOf(c)).toHaveLength(1);
    }
  });

  it("13a. «نفسه» with something in the cart → today's reply to text not understood, and the streak grows", async () => {
    const s = await shop("k13a");
    const c = await returning(s, [{ item: "شاورما دجاج", qty: 2 }]);
    await c.say("3");

    await c.say("نفسه");
    expect(c.reply()).toBe(nothingUnderstoodAr(6));
    expect((await c.context())["unparsed_streak"]).toBe(1);
    expect(await cartOf(c)).toEqual([
      expect.objectContaining({ item_id: s.ids["فلافل"], qty: 1 }),
    ]);
    expect(await c.state()).toBe("browsing");
  });

  it("13b. «نفسه» in a session with no suggestion → the same, and the streak grows", async () => {
    const s = await shop("k13b");
    const c = customer(s);
    await c.say("مرحبا");

    await c.say("نفسه");
    expect(c.reply()).toBe(nothingUnderstoodAr(6));
    expect((await c.context())["unparsed_streak"]).toBe(1);
    expect(await cartOf(c)).toEqual([]);
    expect(await c.state()).toBe("browsing");
  });

  it("14. an item switched off between the welcome and «نفسه» → the rest is added, the missing line opens the reply", async () => {
    const s = await shop("k14");
    const c = await returning(s, [
      { item: "شاورما دجاج", qty: 2 },
      { item: "بطاطا", qty: 1 },
    ]);
    await audit.query(
      `UPDATE menu_items SET is_available = false WHERE id = $1`,
      [s.ids["بطاطا"]],
    );

    await c.say("نفسه");
    expect(c.reply()).toBe(
      "الصنف بطاطا غير متوفر الآن.\n" +
        "ملخّص طلبك:\n" +
        "1 · شاورما دجاج ×2 — 30.00 د.أ\n" +
        "المجموع 30.00 د.أ\n" +
        "الاستلام من المطعم\n" +
        "الدفع نقدا.\n" +
        "اكتب «أكّد» لإرسال الطلب، أو «عدّل» أو «ألغِ».",
    );
    expect(await cartOf(c)).toEqual([
      expect.objectContaining({ item_id: s.ids["شاورما دجاج"], qty: 2 }),
    ]);
    expect(await c.state()).toBe("cart_review");
  });

  it("15. every item switched off before «نفسه» → the missing line and CART_EMPTY_AR; still browsing", async () => {
    const s = await shop("k15");
    const c = await returning(s, [
      { item: "شاورما دجاج", qty: 2 },
      { item: "بطاطا", qty: 1 },
    ]);
    await audit.query(
      `UPDATE menu_items SET is_available = false WHERE id = ANY($1::uuid[])`,
      [[s.ids["شاورما دجاج"], s.ids["بطاطا"]]],
    );

    expect(await c.say("نفسه")).toBe("browsing");
    expect(c.reply()).toBe(
      "الأصناف شاورما دجاج، بطاطا غير متوفرة الآن.\n" +
        "سلّتك فارغة. اكتب رقم الصنف من المنيو.",
    );
    expect(await cartOf(c)).toEqual([]);
    expect(await c.state()).toBe("browsing");
  });

  it("20. end to end: «نفسه» → «استلام» → «أكّد» writes the order with the suggestion's lines at today's prices", async () => {
    const s = await shop("k20", { offersDelivery: true, deliveryFee: "1.50" });
    const c = await returning(s, [
      { item: "شاورما دجاج", qty: 2, price: "12.00" },
      { item: "مشروب", qty: 3, price: "3.00" },
    ]);

    await c.say("نفسه");
    await c.say("استلام");
    expect(await c.say("أكّد")).toBe("cart_review");
    expect(await c.state()).toBe("order_placed");

    const { rows: placed } = await audit.query<{
      id: string;
      subtotal: string;
      total: string;
      status: string;
    }>(
      `SELECT id, subtotal::text, total::text, status::text FROM orders
        WHERE restaurant_id = $1 AND status = 'pending_acceptance'`,
      [s.id],
    );
    expect(placed).toHaveLength(1);
    expect(placed[0]?.subtotal).toBe("42.00");
    expect(placed[0]?.total).toBe("42.00");

    const { rows: lines } = await audit.query<{
      menu_item_id: string;
      item_name_snapshot: string;
      unit_price_snapshot: string;
      quantity: number;
    }>(
      `SELECT menu_item_id, item_name_snapshot, unit_price_snapshot::text, quantity
         FROM order_items WHERE order_id = $1 ORDER BY item_name_snapshot`,
      [placed[0]?.id],
    );
    expect(lines).toEqual([
      {
        menu_item_id: s.ids["شاورما دجاج"],
        item_name_snapshot: "شاورما دجاج",
        unit_price_snapshot: "15.00",
        quantity: 2,
      },
      {
        menu_item_id: s.ids["مشروب"],
        item_name_snapshot: "مشروب",
        unit_price_snapshot: "4.00",
        quantity: 3,
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Past the table
// ---------------------------------------------------------------------------

describe("past the table", () => {
  /**
   * 🔴 The three hours are the database's clock, like brief ح's test 9. The
   *    service's clock is injected a day off the database's; were the age
   *    measured on it, each answer below would flip.
   */
  it("the age is the database's clock: Node's a day ahead does not make a 2-hour-old order old", async () => {
    const s = await shop("k-clock-ahead");
    const plain = await plainFirstMessage(s);
    const ahead = new ConversationService(
      replies,
      () => new Date(Date.now() + 24 * 3600 * 1000),
    );
    const c = customer(s, nextCustomer(), () => ahead);
    await pastOrder(s, c.from, {
      status: "accepted",
      ageMinutes: 2 * HOURS,
      lines: [{ item: "فلافل", qty: 1 }],
    });

    await c.say("مرحبا");
    expect(c.reply()).toBe(plain);
  });

  it("the age is the database's clock: Node's a day behind does not make a 4-hour-old order recent", async () => {
    const s = await shop("k-clock-behind");
    const behind = new ConversationService(
      replies,
      () => new Date(Date.now() - 24 * 3600 * 1000),
    );
    const c = customer(s, nextCustomer(), () => behind);
    await pastOrder(s, c.from, {
      status: "accepted",
      ageMinutes: 4 * HOURS,
      lines: [{ item: "فلافل", qty: 1 }],
    });

    await c.say("مرحبا");
    expect(c.reply()).toContain(
      "آخر طلب لك:\nفلافل ×1 — 5.00 د.أ\nالمجموع 5.00 د.أ\nاكتب «نفسه» لتكرار الطلب.",
    );
  });

  it("REORDER_MIN_AGE_MINUTES is the service's: at 1 minute, an order 2 minutes old is suggested", async () => {
    const s = await shop("k-env");
    const quick = new ConversationService(replies, undefined, undefined, 1);
    const c = customer(s, nextCustomer(), () => quick);
    await pastOrder(s, c.from, {
      status: "accepted",
      ageMinutes: 2,
      lines: [{ item: "فلافل", qty: 1 }],
    });

    await c.say("مرحبا");
    expect(c.reply()).toContain("آخر طلب لك:");
  });

  it("«نفسه» outside browsing is not understood as reorder: the fee question, the address step, the summary", async () => {
    const s = await shop("k-states", {
      offersDelivery: true,
      deliveryFee: "1.50",
    });
    const a = await returning(s, [{ item: "فلافل", qty: 1 }]);
    const b = await returning(s, [{ item: "فلافل", qty: 1 }]);
    await a.say("1");
    await a.say("تم");
    await b.say("1");
    await b.say("تم");

    // The fee question: «نفسه» gets what any other text gets there.
    await a.say("نفسه");
    const toNafsuh = a.reply();
    await b.say("كلام");
    expect(toNafsuh).toBe(b.reply());
    expect(await a.state()).toBe("fulfillment_choice");

    // The address step: like «تم» or «منيو», a command word is not an
    // address — the question again, and no address kept.
    await a.say("توصيل");
    await a.say("نفسه");
    expect(a.reply()).toBe(ADDRESS_ASK_AR);
    expect(
      ((await a.context())["fulfillment"] as { address: unknown }).address,
    ).toBeNull();

    // The summary: the confirm prompt, as for any text.
    await a.say("شارع الجامعة، بناية 12");
    expect(await a.state()).toBe("cart_review");
    await a.say("نفسه");
    expect(a.reply()).toBe(CONFIRM_PROMPT_AR);
    expect(await a.state()).toBe("cart_review");
  });
});
