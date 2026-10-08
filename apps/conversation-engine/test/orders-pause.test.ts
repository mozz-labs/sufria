/**
 * ja-3 · orders paused, and a menu with nothing to show — brief ي-أ §4,
 * tests 1–11, on a real database with the recording sender.
 *
 * The harness is `session-timeout.test.ts`'s: sessions are made through the
 * real path (`handleInbound`), aged with `UPDATE … last_message_at = now() -
 * interval` from the audit connection, and read back above RLS — never through
 * the code that wrote them. The pause is set where the dashboard sets it,
 * `restaurants.orders_paused_at`.
 *
 * Every read is narrowed to a restaurant this file created — `orders` above
 * all (CLAUDE.md: the API suite runs alongside).
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
import { Pool } from "pg";
import {
  CLOSED_AR,
  MENU_HEADER_AR,
  ORDERS_PAUSED_AR,
  cartMessageAr,
  itemsRemovedUnavailableLineAr,
  welcomeMessageAr,
} from "@sufria/shared";

import {
  ConversationService,
  flushDeferred,
  type DeferredSend,
} from "../src/conversation/session.service.js";
import { TenantDb } from "../src/db/tenant-db.js";
import { RecordingWhatsAppSender } from "../src/whatsapp/sender.js";

const RUN = randomUUID();
const phoneId = (label: string): string => `PHONE.PAUSE.${RUN}.${label}`;
const NAME = `مطعم الإيقاف ${RUN}`;

let customerSeq = 0;
const nextCustomer = (): string =>
  `96276${String(++customerSeq).padStart(7, "0")}`;

/** `{}` = always open. */
const ALWAYS_OPEN_HOURS = {};
/** No open day at all — «closed» without depending on the clock. */
const ALWAYS_CLOSED_HOURS = {
  days: { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] },
};

const ITEMS = [
  { name: "شاورما عربي", price: "6.00" },
  { name: "حمص", price: "2.50" },
];

let db: TenantDb;
let audit: Pool;
let replies: RecordingWhatsAppSender;
let conversation: ConversationService;
const createdRestaurants: string[] = [];

interface SessionRow {
  id: string;
  state: string;
  context: Record<string, unknown>;
  /** Text, not `Date`: compared to the microsecond. */
  lastMessageAt: string;
}

interface Shop {
  restaurantId: string;
  from: string;
  ids: Record<string, string>;
  say: (body: string) => Promise<string>;
  sessions: () => Promise<SessionRow[]>;
  active: () => Promise<SessionRow>;
  replies: () => string[];
  orders: () => Promise<number>;
}

/**
 * A restaurant with one category and `ITEMS`, and a customer who has sent
 * nothing yet.
 */
async function shop(opts: {
  label: string;
  hours?: object;
  categoryActive?: boolean;
  itemsAvailable?: boolean;
  from?: string;
}): Promise<Shop> {
  const pid = phoneId(opts.label);
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status, business_hours,
                              offers_delivery)
     VALUES ($1, $2, 'active'::restaurant_status, $3::jsonb, false)
     RETURNING id`,
    [NAME, pid, JSON.stringify(opts.hours ?? ALWAYS_OPEN_HOURS)],
  );
  const restaurantId = rows[0]?.id ?? "";
  createdRestaurants.push(restaurantId);

  const cat = await audit.query<{ id: string }>(
    `INSERT INTO menu_categories (restaurant_id, name, is_active)
     VALUES ($1, 'مقبلات', $2) RETURNING id`,
    [restaurantId, opts.categoryActive ?? true],
  );
  const ids: Record<string, string> = {};
  for (const [i, item] of ITEMS.entries()) {
    const r = await audit.query<{ id: string }>(
      `INSERT INTO menu_items (restaurant_id, category_id, name, price,
                               display_order, is_available)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        restaurantId,
        cat.rows[0]?.id,
        item.name,
        item.price,
        i,
        opts.itemsAvailable ?? true,
      ],
    );
    ids[item.name] = r.rows[0]?.id ?? "";
  }

  const from = opts.from ?? nextCustomer();

  /** A whole message as the webhook runs it: the transaction, then the queue. */
  const say = async (body: string): Promise<string> => {
    const deferred: DeferredSend[] = [];
    const outcome = await db.runInTenant(restaurantId, (tx) =>
      conversation.handleInbound(tx, {
        restaurantId,
        phoneNumberId: pid,
        from,
        body,
        deferred,
      }),
    );
    await flushDeferred(conversation.sender, deferred);
    return outcome;
  };

  const sessions = async (): Promise<SessionRow[]> => {
    const { rows: r } = await audit.query<SessionRow>(
      `SELECT s.id, s.state::text AS state, s.context,
              s.last_message_at::text AS "lastMessageAt"
         FROM conversation_sessions s
         JOIN customers c ON c.id = s.customer_id
        WHERE s.restaurant_id = $1 AND c.phone_number = $2
        ORDER BY s.created_at, s.id`,
      [restaurantId, from],
    );
    return r;
  };

  return {
    restaurantId,
    from,
    ids,
    say,
    sessions,
    active: async () => {
      const live = (await sessions()).filter(
        (s) => s.state !== "order_placed" && s.state !== "abandoned",
      );
      expect(live).toHaveLength(1);
      return live[0] as SessionRow;
    },
    replies: () => replies.forRestaurant(restaurantId).map((m) => m.body),
    // 🔴 This restaurant's orders alone — never the whole table.
    orders: async () => {
      const { rows: r } = await audit.query<{ n: string }>(
        `SELECT count(*) AS n FROM orders WHERE restaurant_id = $1`,
        [restaurantId],
      );
      return Number(r[0]?.n);
    },
  };
}

/** What the dashboard's «أوقف الطلبات مؤقتا» writes. */
async function pause(s: Shop): Promise<void> {
  await audit.query(
    `UPDATE restaurants SET orders_paused_at = now() WHERE id = $1`,
    [s.restaurantId],
  );
}

async function resume(s: Shop): Promise<void> {
  await audit.query(
    `UPDATE restaurants SET orders_paused_at = NULL WHERE id = $1`,
    [s.restaurantId],
  );
}

/** Puts `last_message_at` back by the database's clock — the one the timeout reads. */
async function age(sessionId: string, interval: string): Promise<void> {
  const { rowCount } = await audit.query(
    `UPDATE conversation_sessions
        SET last_message_at = now() - $2::interval
      WHERE id = $1`,
    [sessionId, interval],
  );
  expect(rowCount).toBe(1);
}

/** A customer who got the menu and put «شاورما عربي» in the cart. */
async function midOrder(label: string): Promise<Shop> {
  const s = await shop({ label });
  expect(await s.say("مرحبا")).toBe("greeted");
  expect(await s.say("1")).toBe("browsing");
  expect((await s.active()).state).toBe("browsing");
  replies.reset();
  return s;
}

/** The cart as «سلة» shows it with «شاورما عربي» ×1 in it. */
const ONE_SHAWARMA_CART = cartMessageAr(
  [{ menuNumber: 1, name: "شاورما عربي", qty: 1, lineTotalMinor: 600 }],
  600,
  "JOD",
);

beforeAll(async () => {
  const url = process.env["MIGRATION_DATABASE_URL"];
  if (!url)
    throw new Error("MIGRATION_DATABASE_URL is missing — see .env.example");
  audit = new Pool({ connectionString: url, max: 2 });
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
    // The cascade takes customers, sessions and orders along.
    await audit.query("DELETE FROM restaurants WHERE id = ANY($1::uuid[])", [
      createdRestaurants,
    ]);
  }
  await audit.end();
});

// ---------------------------------------------------------------------------

describe("orders paused — brief ي-أ §4", () => {
  it("1. 🔴 paused + a new customer's «مرحبا» → ORDERS_PAUSED_AR, and no session", async () => {
    const s = await shop({ label: "t1" });
    await pause(s);

    expect(await s.say("مرحبا")).toBe("orders_paused");

    expect(s.replies()).toEqual([ORDERS_PAUSED_AR]);
    expect(await s.sessions()).toEqual([]);
  });

  it("2. 🔴 paused + a customer mid-order sends a number → ORDERS_PAUSED_AR, and the session exactly as it was", async () => {
    const s = await midOrder("t2");
    await pause(s);
    const before = await s.sessions();

    expect(await s.say("2")).toBe("orders_paused");

    expect(s.replies()).toEqual([ORDERS_PAUSED_AR]);
    // State, context (the cart within it) and last_message_at, to the microsecond.
    expect(await s.sessions()).toEqual(before);
  });

  it("3. 🔴 paused + «أكّد» at cart_review → ORDERS_PAUSED_AR, and no order", async () => {
    const s = await midOrder("t3");
    await s.say("تم");
    expect((await s.active()).state).toBe("cart_review");
    await pause(s);
    replies.reset();
    const before = await s.sessions();

    expect(await s.say("أكّد")).toBe("orders_paused");

    expect(s.replies()).toEqual([ORDERS_PAUSED_AR]);
    expect(await s.orders()).toBe(0);
    expect(await s.sessions()).toEqual(before);
  });

  it("4. the customer of 2, once orders resume, sends «سلة» → the whole cart", async () => {
    const s = await midOrder("t4");
    await pause(s);
    expect(await s.say("2")).toBe("orders_paused");
    await resume(s);
    replies.reset();

    expect(await s.say("سلة")).toBe("browsing");

    // «شاورما عربي» ×1 — and not «حمص», which was asked for while paused.
    expect(s.replies()).toEqual([ONE_SHAWARMA_CART]);
  });

  it("5. closed and paused + a new customer → the closing text, not the paused one — and no session", async () => {
    const s = await shop({ label: "t5", hours: ALWAYS_CLOSED_HOURS });
    await pause(s);

    expect(await s.say("مرحبا")).toBe("closed");

    expect(s.replies()).toEqual([CLOSED_AR]);
    expect(await s.sessions()).toEqual([]);
  });

  it("10. paused + a session silent 61 minutes → the old one abandoned, ORDERS_PAUSED_AR, no new session", async () => {
    const s = await midOrder("t10");
    await pause(s);
    await age((await s.active()).id, "61 minutes");

    expect(await s.say("مرحبا")).toBe("orders_paused");

    expect((await s.sessions()).map((x) => x.state)).toEqual(["abandoned"]);
    expect(s.replies()).toEqual([ORDERS_PAUSED_AR]);
  });

  it("11. two restaurants, the same number: restaurant A paused, B answers as always", async () => {
    const a = await shop({ label: "t11-a" });
    const b = await shop({ label: "t11-b", from: a.from });
    await pause(a);

    // The control: A's pause is in force — without it, B answering proves nothing.
    expect(await a.say("مرحبا")).toBe("orders_paused");
    expect(a.replies()).toEqual([ORDERS_PAUSED_AR]);

    expect(await b.say("مرحبا")).toBe("greeted");
    const [reply] = b.replies();
    expect(b.replies()).toHaveLength(1);
    expect(reply?.startsWith(welcomeMessageAr(NAME))).toBe(true);
    expect(reply).toContain(MENU_HEADER_AR);
    expect((await b.active()).state).toBe("browsing");
    expect(await a.sessions()).toEqual([]);
  });
});

describe("a menu with nothing to show — brief ي-أ §4, decision 3", () => {
  it("6. 🔴 no available item + a new customer → ORDERS_PAUSED_AR, and no session", async () => {
    const s = await shop({ label: "t6", itemsAvailable: false });

    expect(await s.say("مرحبا")).toBe("empty_menu");

    expect(s.replies()).toEqual([ORDERS_PAUSED_AR]);
    expect(await s.sessions()).toEqual([]);
  });

  it("7. available items, all in an inactive category + a new customer → the same as 6", async () => {
    const s = await shop({ label: "t7", categoryActive: false });

    expect(await s.say("مرحبا")).toBe("empty_menu");

    expect(s.replies()).toEqual([ORDERS_PAUSED_AR]);
    expect(await s.sessions()).toEqual([]);
  });

  it("8. no item left + «منيو» in an active session → ORDERS_PAUSED_AR, and the session untouched", async () => {
    const s = await midOrder("t8");
    await audit.query(
      `UPDATE menu_items SET is_available = false WHERE restaurant_id = $1`,
      [s.restaurantId],
    );
    const before = await s.sessions();

    expect(await s.say("منيو")).toBe("browsing");

    // Not an empty menu, and not the «removed from your cart» line either: the
    // cart is pruned only where a menu is written, and none was.
    expect(s.replies()).toEqual([ORDERS_PAUSED_AR]);
    expect(await s.sessions()).toEqual(before);
  });
});

describe("archiving — brief ي-أ §2 and §4", () => {
  it("9. an item in the cart is archived, then «أكّد» → it leaves the cart with the existing «unavailable» line, the very path of a switched-off item", async () => {
    const s = await midOrder("t9");
    await s.say("2");
    await s.say("تم");
    expect((await s.active()).state).toBe("cart_review");
    replies.reset();

    // What the dashboard's «إزالة من المنيو» writes (brief ي-أ §5).
    await audit.query(
      `UPDATE menu_items SET archived_at = now(), is_available = false
        WHERE id = $1`,
      [s.ids["شاورما عربي"]],
    );

    expect(await s.say("أكّد")).toBe("cart_review");

    const sent = s.replies();
    expect(sent[0]).toBe(itemsRemovedUnavailableLineAr(["شاورما عربي"]));
    expect(sent[1]).toContain("ملخّص طلبك:");
    expect(await s.orders()).toBe(0);
    const session = await s.active();
    expect(session.state).toBe("cart_review");
    expect(
      (session.context["cart"] as { name: string }[]).map((l) => l.name),
    ).toEqual(["حمص"]);
  });
});
