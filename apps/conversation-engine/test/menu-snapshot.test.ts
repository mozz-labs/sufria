/**
 * ja-2 · the menu's text, to the letter — a snapshot taken before it moved to
 * `packages/shared` (brief ي-أ §3, item 2).
 *
 * `renderMenuText` and the first message's composition (the welcome, `"\n"`,
 * the menu) move to shared because the API's 4096 guard needs the very same
 * computation. The move must not change one character, so this file was
 * written BEFORE it, the files in `fixtures/menu-snapshot/` were generated
 * from the engine's code of that moment, and the move changes neither.
 *
 * 🔴 From the outside, not from the functions: each text is asked of
 *    `handleInbound` on a real database and read off the recording sender.
 *    The test does not know where the code lives, so the move cannot touch
 *    it — and it pins `readMenu`'s order, the numbering and the currency too,
 *    not the template alone.
 *
 * The cases: `db/restaurants/demo.json`'s menu as it is (the first message,
 * and «منيو»), and 100 items in two categories, in both currencies.
 */
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import type { Currency } from "@sufria/shared";

import { ConversationService } from "../src/conversation/session.service.js";
import { TenantDb } from "../src/db/tenant-db.js";
import { RecordingWhatsAppSender } from "../src/whatsapp/sender.js";

const RUN = randomUUID();

let customerSeq = 0;
const nextCustomer = (): string =>
  `96277${String(++customerSeq).padStart(7, "0")}`;

interface MenuSpec {
  name: string;
  items: { name: string; price: string }[];
}

/** 100 items in two categories, names and prices varied — what made the files. */
const DISHES = [
  "شاورما دجاج",
  "شاورما لحمة",
  "فلافل",
  "حمّص",
  "متبل",
  "فتوش",
  "كبة مقلية",
  "سمبوسة جبنة",
  "بطاطا",
  "مشروب غازي",
];
const SIZES = ["صغير", "وسط", "كبير", "عائلي", "دبل"];
const PRICES = ["13.50", "2.00", "0.75", "125.25", "9.99", "1.05", "30.00"];
const HUNDRED: MenuSpec[] = ["سندويشات", "وجبات"].map((name, c) => ({
  name,
  items: Array.from({ length: 50 }, (_, k) => {
    const i = c * 50 + k;
    return {
      name: `${DISHES[i % 10]} ${SIZES[Math.floor(i / 10) % 5]}`,
      price: PRICES[i % 7] as string,
    };
  }),
}));
const HUNDRED_NAME = "مطعم المئة صنف";

const DEMO = JSON.parse(
  readFileSync(resolve(__dirname, "../../../db/restaurants/demo.json"), "utf8"),
) as { name: string; currency: Currency; menu: MenuSpec[] };

/** The file as it is, never edited — it is the reference. */
const snapshot = (name: string): string =>
  readFileSync(resolve(__dirname, "fixtures/menu-snapshot", name), "utf8");

let db: TenantDb;
let audit: Pool;
let replies: RecordingWhatsAppSender;
let conversation: ConversationService;
const createdRestaurants: string[] = [];

/**
 * An always-open restaurant with the spec's menu, `display_order` = position
 * as the setup script writes it (brief E). Returns one customer's `say`: it
 * sends a message and returns the one reply.
 */
async function restaurant(
  label: string,
  name: string,
  currency: Currency,
  menu: MenuSpec[],
): Promise<(body: string) => Promise<string>> {
  const pid = `PHONE.SNAP.${RUN}.${label}`;
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status, business_hours, currency)
     VALUES ($1, $2, 'active'::restaurant_status, '{}'::jsonb, $3)
     RETURNING id`,
    [name, pid, currency],
  );
  const restaurantId = rows[0]?.id ?? "";
  createdRestaurants.push(restaurantId);

  for (const [c, category] of menu.entries()) {
    const cat = await audit.query<{ id: string }>(
      `INSERT INTO menu_categories (restaurant_id, name, display_order)
       VALUES ($1, $2, $3) RETURNING id`,
      [restaurantId, category.name, c],
    );
    for (const [i, item] of category.items.entries()) {
      await audit.query(
        `INSERT INTO menu_items (restaurant_id, category_id, name, price, display_order)
         VALUES ($1, $2, $3, $4::numeric, $5)`,
        [restaurantId, cat.rows[0]?.id, item.name, item.price, i],
      );
    }
  }

  const from = nextCustomer();
  return async (body: string): Promise<string> => {
    replies.reset();
    await db.runInTenant(restaurantId, (tx) =>
      conversation.handleInbound(tx, {
        restaurantId,
        phoneNumberId: pid,
        from,
        body,
        deferred: [],
      }),
    );
    const sent = replies.forRestaurant(restaurantId);
    expect(sent).toHaveLength(1);
    return sent[0]?.body ?? "";
  };
}

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

afterAll(async () => {
  await db.stop();
  if (createdRestaurants.length > 0) {
    // The cascade takes the categories, items, customers and sessions along.
    await audit.query("DELETE FROM restaurants WHERE id = ANY($1::uuid[])", [
      createdRestaurants,
    ]);
  }
  await audit.end();
});

describe("🔴 the menu's text, to the letter (brief ي-أ §3)", () => {
  it("demo.json's menu: the first message (welcome + menu), and «منيو» (the menu alone)", async () => {
    const say = await restaurant("demo", DEMO.name, DEMO.currency, DEMO.menu);

    expect(await say("مرحبا")).toBe(snapshot("demo-first.txt"));
    expect(await say("منيو")).toBe(snapshot("demo-menu.txt"));
  });

  it("100 items in two categories, in dinars", async () => {
    const say = await restaurant("jod", HUNDRED_NAME, "JOD", HUNDRED);

    expect(await say("مرحبا")).toBe(snapshot("hundred-jod-first.txt"));
  });

  it("100 items in two categories, in shekels", async () => {
    const say = await restaurant("ils", HUNDRED_NAME, "ILS", HUNDRED);

    expect(await say("مرحبا")).toBe(snapshot("hundred-ils-first.txt"));
  });
});
