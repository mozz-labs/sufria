/**
 * I-4 · the saving wrapper (brief I §4, §5 test 3): every text that went out
 * is kept in `outbound_messages` — after the send, never before; under the
 * message's restaurant alone; and the save neither stops the reply nor makes
 * it hang.
 *
 * On a real database with the recording sender. Fixtures are written, and
 * rows read back, through the audit connection above RLS; every read is
 * narrowed to a restaurant this file created (the API suite runs alongside).
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
import { sql } from "drizzle-orm";
import { Pool, type PoolClient } from "pg";
import { WHATSAPP_TEXT_LIMIT, type OrderStatus } from "@sufria/shared";

import { ConversationService } from "../src/conversation/session.service.js";
import { TenantDb } from "../src/db/tenant-db.js";
import { maskPhone } from "../src/logger.js";
import { OrderNotifier } from "../src/notify/order-notifier.js";
import { parseWebhookPayload } from "../src/whatsapp/payload.js";
import {
  SAVE_TIMEOUT_MS,
  SavingWhatsAppSender,
  type SaveLog,
} from "../src/whatsapp/saving-sender.js";
import {
  OutboundTextTooLongError,
  RecordingWhatsAppSender,
  WhatsAppSendError,
  type OutboundTextMessage,
} from "../src/whatsapp/sender.js";
import { WebhookService } from "../src/whatsapp/webhook.service.js";

const RUN = randomUUID();

/** The engine's pool — the inbound transaction's, and the notifier's. */
let db: TenantDb;
/** The wrapper's own pool, as `main.ts` builds it. */
let saveDb: TenantDb;
let audit: Pool;
let recording: RecordingWhatsAppSender;
const createdRestaurants: string[] = [];

let phoneSeq = 0;
const nextPhone = (): string => `96278${String(++phoneSeq).padStart(7, "0")}`;

interface Shop {
  id: string;
  phoneNumberId: string;
}

/** An always-open restaurant with one item on its menu. */
async function shop(label: string): Promise<Shop> {
  const phoneNumberId = `PHONE.SAVE.${RUN}.${label}`;
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status, business_hours)
     VALUES ($1, $2, 'active'::restaurant_status, '{}'::jsonb)
     RETURNING id`,
    [`مطعم الصادر ${label} ${RUN}`, phoneNumberId],
  );
  const id = rows[0]?.id ?? "";
  createdRestaurants.push(id);
  const category = await audit.query<{ id: string }>(
    `INSERT INTO menu_categories (restaurant_id, name) VALUES ($1, 'مشاوي') RETURNING id`,
    [id],
  );
  await audit.query(
    `INSERT INTO menu_items (restaurant_id, category_id, name, price)
     VALUES ($1, $2, 'شيش طاووق', 4.50)`,
    [id, category.rows[0]?.id],
  );
  return { id, phoneNumberId };
}

let orderNumber = 101;

/** A customer and an order of theirs, `notified = false`, as the API leaves it. */
async function order(
  s: Shop,
  status: OrderStatus = "accepted",
): Promise<{ id: string; to: string }> {
  const to = nextPhone();
  const customer = await audit.query<{ id: string }>(
    `INSERT INTO customers (restaurant_id, phone_number) VALUES ($1, $2) RETURNING id`,
    [s.id, to],
  );
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO orders (restaurant_id, customer_id, order_number, fulfillment_type,
                         payment_method, status, payment_status, notified,
                         subtotal, delivery_fee, total)
     VALUES ($1, $2, $3, 'pickup', 'cash', $4::order_status, 'pending_cash',
             false, 5.00, 0, 5.00)
     RETURNING id`,
    [s.id, customer.rows[0]?.id, orderNumber++, status],
  );
  return { id: rows[0]?.id ?? "", to };
}

interface Row {
  restaurant_id: string;
  to_phone: string;
  body: string;
  order_id: string | null;
}

/** What `outbound_messages` holds for one restaurant, read above RLS. */
async function outboundOf(restaurantId: string): Promise<Row[]> {
  const { rows } = await audit.query<Row>(
    `SELECT restaurant_id, to_phone, body, order_id
       FROM outbound_messages
      WHERE restaurant_id = $1
      ORDER BY sent_at, id`,
    [restaurantId],
  );
  return rows;
}

function captureLog(): { lines: { obj: object; msg: string }[]; log: SaveLog } {
  const lines: { obj: object; msg: string }[] = [];
  return { lines, log: { error: (obj, msg) => lines.push({ obj, msg }) } };
}

const message = (
  s: Shop,
  to: string,
  extra: Partial<OutboundTextMessage> = {},
): OutboundTextMessage => ({
  restaurantId: s.id,
  phoneNumberId: s.phoneNumberId,
  to,
  body: "أكّدنا طلبك.",
  ...extra,
});

beforeAll(async () => {
  const url = process.env["MIGRATION_DATABASE_URL"];
  if (!url) throw new Error("MIGRATION_DATABASE_URL مفقود — انسخ .env.example");
  audit = new Pool({ connectionString: url, max: 3 });
  db = new TenantDb();
  await db.start();
  saveDb = new TenantDb();
  await saveDb.start();
  recording = new RecordingWhatsAppSender();
});

afterEach(() => {
  recording.reset();
});

afterAll(async () => {
  await db.stop();
  await saveDb.stop();
  if (createdRestaurants.length > 0) {
    // cascade: customers, orders, menus, inbound and outbound messages.
    await audit.query("DELETE FROM restaurants WHERE id = ANY($1::uuid[])", [
      createdRestaurants,
    ]);
  }
  await audit.end();
});

describe("what is kept (§5 test 3)", () => {
  it("a send that went out: one row — the restaurant, the number, the text, the order", async () => {
    const s = await shop("sent");
    const o = await order(s);
    const sender = new SavingWhatsAppSender(recording, saveDb);

    await sender.sendText(message(s, o.to, { orderId: o.id }));
    await sender.sendText(message(s, o.to, { body: "سطر بلا طلب" }));

    expect(recording.forRestaurant(s.id)).toHaveLength(2);
    expect(await outboundOf(s.id)).toEqual([
      {
        restaurant_id: s.id,
        to_phone: o.to,
        body: "أكّدنا طلبك.",
        order_id: o.id,
      },
      {
        restaurant_id: s.id,
        to_phone: o.to,
        body: "سطر بلا طلب",
        order_id: null,
      },
    ]);
  });

  it("🔴 a send that failed: no row, and the failure is still the caller's", async () => {
    const s = await shop("failed");
    const failing = {
      sendText: async (): Promise<void> => {
        throw new WhatsAppSendError("ميتا رفضت الإرسال: 400", 400, 131047);
      },
    };
    const sender = new SavingWhatsAppSender(failing, saveDb);

    await expect(sender.sendText(message(s, nextPhone()))).rejects.toThrow(
      WhatsAppSendError,
    );
    expect(await outboundOf(s.id)).toEqual([]);
  });

  it("🔴 a save that failed: no exception, the reply went out, one error line with the number masked", async () => {
    const s = await shop("save-failed");
    const to = nextPhone();
    const { lines, log } = captureLog();
    const sender = new SavingWhatsAppSender(recording, saveDb, log);

    // No such order: the tenant key refuses the row — a real failure of the save.
    await expect(
      sender.sendText(message(s, to, { orderId: randomUUID() })),
    ).resolves.toBeUndefined();

    expect(recording.forRestaurant(s.id).map((m) => m.to)).toEqual([to]);
    expect(await outboundOf(s.id)).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.obj).toMatchObject({
      restaurantId: s.id,
      to: maskPhone(to),
    });
    // Neither the number nor the text reaches the log line (logger.ts).
    const written = JSON.stringify(lines);
    expect(written).not.toContain(to);
    expect(written).not.toContain("أكّدنا طلبك.");
  });

  it("a text over WhatsApp's limit: no row", async () => {
    const s = await shop("too-long");
    const sender = new SavingWhatsAppSender(recording, saveDb);

    await expect(
      sender.sendText(
        message(s, nextPhone(), { body: "x".repeat(WHATSAPP_TEXT_LIMIT + 1) }),
      ),
    ).rejects.toThrow(OutboundTextTooLongError);
    expect(await outboundOf(s.id)).toEqual([]);
  });

  it("🔴 the row is under the message's restaurant, and no other restaurant reads it", async () => {
    const a = await shop("tenant-a");
    const b = await shop("tenant-b");
    const to = nextPhone();
    const sender = new SavingWhatsAppSender(recording, saveDb);

    await sender.sendText(message(a, to));

    expect((await outboundOf(a.id)).map((r) => r.to_phone)).toEqual([to]);
    expect(await outboundOf(b.id)).toEqual([]);
    const seenBy = (restaurantId: string) =>
      saveDb.runInTenant(restaurantId, async (tx) => {
        const res = await tx.execute<{ n: number }>(
          // A number only this test sent to: no other suite's rows are counted.
          sqlCount(to),
        );
        return Number(res.rows[0]?.n);
      });
    expect(await seenBy(a.id)).toBe(1);
    expect(await seenBy(b.id)).toBe(0);
  });

  it("order-notifier passes the order: its message carries orderId, and its row the order", async () => {
    const s = await shop("notifier");
    const o = await order(s, "accepted");
    const notifier = new OrderNotifier(
      db,
      new SavingWhatsAppSender(recording, saveDb),
      { sleep: async () => undefined, restaurantScope: [s.id] },
    );

    await notifier.tick();

    expect(recording.forRestaurant(s.id)).toEqual([
      expect.objectContaining({ to: o.to, orderId: o.id }),
    ]);
    expect(await outboundOf(s.id)).toEqual([
      expect.objectContaining({ to_phone: o.to, order_id: o.id }),
    ]);
  });
});

describe("🔴 a message inside an open transaction (Mohammed, 5 October)", () => {
  it("a reply sent inside the inbound message's transaction arrives, is kept without an order, and nothing hangs", async () => {
    const s = await shop("in-transaction");
    const from = nextPhone();
    const webhook = new WebhookService(
      db,
      new ConversationService(new SavingWhatsAppSender(recording, saveDb)),
    );
    const parsed = parseWebhookPayload({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_TEST",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "962790000000",
                  phone_number_id: s.phoneNumberId,
                },
                messages: [
                  {
                    from,
                    id: `wamid.SAVE.${RUN}`,
                    timestamp: "1757000000",
                    type: "text",
                    text: { body: "مرحبا" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    if (parsed === null) throw new Error("the payload did not parse");

    const started = Date.now();
    // The engine's pool is one connection here (PG_POOL_MAX=1): the inbound
    // transaction holds it while the reply is sent and saved.
    expect(await webhook.ingest(parsed)).toEqual(["stored"]);
    // Hanging is seconds (a lock wait, a pool timeout); this is not.
    expect(Date.now() - started).toBeLessThan(SAVE_TIMEOUT_MS * 2);

    const sent = recording.forRestaurant(s.id);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((m) => m.orderId === undefined)).toBe(true);
    expect(
      (await outboundOf(s.id)).map((r) => [r.to_phone, r.body, r.order_id]),
    ).toEqual(sent.map((m) => [from, m.body, null]));
  });

  it("a save that waits on a row an open transaction holds gives up after 2 seconds — the reply arrives", async () => {
    const s = await shop("held-row");
    const o = await order(s);
    const { lines, log } = captureLog();
    const sender = new SavingWhatsAppSender(recording, saveDb, log);

    // An open transaction holding the order's row: the save's tenant-key
    // check needs a share lock on it, and waits.
    const holder: PoolClient = await audit.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM orders WHERE id = $1 FOR UPDATE", [
        o.id,
      ]);

      const started = Date.now();
      await sender.sendText(message(s, o.to, { orderId: o.id }));
      const elapsed = Date.now() - started;

      expect(elapsed).toBeGreaterThanOrEqual(SAVE_TIMEOUT_MS - 100);
      expect(elapsed).toBeLessThan(SAVE_TIMEOUT_MS * 2);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
    expect(recording.forRestaurant(s.id).map((m) => m.to)).toEqual([o.to]);
    expect(await outboundOf(s.id)).toEqual([]);
    // Gave up by its own timeouts — both 2 s, so the statement's (57014),
    // counted from a moment earlier, usually fires before the lock's (55P03).
    expect(lines).toHaveLength(1);
    expect(lines[0]?.obj).toMatchObject({
      err: { code: expect.stringMatching(/^(55P03|57014)$/) },
    });
  });
});

/** `count(*)` of the rows sent to one number, as the context sees them. */
function sqlCount(to: string) {
  return sql`SELECT count(*)::int AS n FROM outbound_messages WHERE to_phone = ${to}`;
}
