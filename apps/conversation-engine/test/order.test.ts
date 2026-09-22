/**
 * ج-5 · «أكّد» ← الطلب — على قاعدة حقيقية.
 *
 * كل اختبار بيمشي المسار الحقيقي، والتحقق بيقرأ `orders` و`order_items`
 * و`order_status_history` باتصال تدقيق فوق RLS — مش من نفس الكود اللي كتبهم.
 *
 * المواصفة: بريف ج §8، وقيم `orders` اللي تحتها، و§15.
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
  CART_EMPTY_AR,
  fulfillmentAskAr,
  itemsRemovedUnavailableLineAr,
  orderReceivedMessageAr,
} from "@sufria/shared";

import {
  ConversationService,
  flushDeferred,
  type DeferredSend,
} from "../src/conversation/session.service.js";
import { TenantDb } from "../src/db/tenant-db.js";
import { RecordingWhatsAppSender } from "../src/whatsapp/sender.js";

const RUN = randomUUID();
const phoneId = (label: string): string => `PHONE.ORD.${RUN}.${label}`;

let customerSeq = 0;
const nextCustomer = (): string =>
  `96276${String(++customerSeq).padStart(7, "0")}`;

/** الحقل الفاضي = «مفتوح دايما» — بلا دقيقة ميتة. */
const ALWAYS_OPEN_HOURS = {};

let db: TenantDb;
let audit: Pool;
let replies: RecordingWhatsAppSender;
let conversation: ConversationService;
const createdRestaurants: string[] = [];

interface OrderRow {
  id: string;
  order_number: number;
  status: string;
  payment_method: string;
  payment_status: string;
  fulfillment_type: string;
  notified: boolean;
  subtotal: string;
  delivery_fee: string;
  total: string;
  delivery_address: string | null;
  outbound_msg_count: number;
  session_id: string | null;
  customer_id: string;
}

interface Shop {
  restaurantId: string;
  /** رقم الزبون اللي بيحكي بـ`say`. */
  from: string;
  /** الترحيب والمنيو، قبل ما ينمسح السجل. */
  greeting: string;
  ids: Record<string, string>;
  say: (body: string | null) => Promise<string>;
  last: () => string | undefined;
  sentCount: () => number;
  context: () => Promise<Record<string, unknown>>;
  state: () => Promise<string>;
  orders: () => Promise<OrderRow[]>;
}

async function shop(opts: {
  label: string;
  offersDelivery?: boolean;
  deliveryFee?: string;
  items?: { name: string; price: string }[];
  /** بلا قيمة = افتراضي القاعدة (`JOD`) — مش قيمة بيحطها الاختبار. */
  currency?: "JOD" | "ILS";
}): Promise<Shop> {
  const pid = phoneId(opts.label);
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status, business_hours,
                              contact_phone, offers_delivery, delivery_fee)
     VALUES ($1, $2, 'active'::restaurant_status, $3::jsonb, '0790000123', $4, $5)
     RETURNING id`,
    [
      `مطعم ${RUN}`,
      pid,
      JSON.stringify(ALWAYS_OPEN_HOURS),
      opts.offersDelivery ?? false,
      opts.deliveryFee ?? "0",
    ],
  );
  const restaurantId = rows[0]?.id ?? "";
  createdRestaurants.push(restaurantId);
  if (opts.currency !== undefined) {
    await audit.query(`UPDATE restaurants SET currency = $2 WHERE id = $1`, [
      restaurantId,
      opts.currency,
    ]);
  }

  const cat = await audit.query<{ id: string }>(
    `INSERT INTO menu_categories (restaurant_id, name) VALUES ($1, 'مقبلات') RETURNING id`,
    [restaurantId],
  );
  const categoryId = cat.rows[0]?.id ?? "";
  const ids: Record<string, string> = {};
  const items = opts.items ?? [
    { name: "شاورما عربي", price: "6.00" },
    { name: "حمص", price: "2.50" },
  ];
  for (const [i, item] of items.entries()) {
    const r = await audit.query<{ id: string }>(
      `INSERT INTO menu_items (restaurant_id, category_id, name, price, display_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [restaurantId, categoryId, item.name, item.price, i],
    );
    ids[item.name] = r.rows[0]?.id ?? "";
  }

  const from = nextCustomer();
  const say = async (body: string | null): Promise<string> => {
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

  expect(await say("مرحبا")).toBe("greeted");
  const greeting = replies.forRestaurant(restaurantId).at(-1)?.body ?? "";
  replies.reset();

  return {
    restaurantId,
    from,
    greeting,
    ids,
    say,
    last: () => replies.forRestaurant(restaurantId).at(-1)?.body,
    sentCount: () => replies.forRestaurant(restaurantId).length,
    context: async () => {
      const { rows: ctx } = await audit.query<{
        context: Record<string, unknown>;
      }>(
        `SELECT s.context FROM conversation_sessions s
           JOIN customers c ON c.id = s.customer_id
          WHERE s.restaurant_id = $1 AND c.phone_number = $2`,
        [restaurantId, from],
      );
      return ctx[0]?.context ?? {};
    },
    state: async () => {
      const { rows: r } = await audit.query<{ state: string }>(
        `SELECT s.state::text AS state FROM conversation_sessions s
           JOIN customers c ON c.id = s.customer_id
          WHERE s.restaurant_id = $1 AND c.phone_number = $2`,
        [restaurantId, from],
      );
      return r[0]?.state ?? "";
    },
    orders: async () => {
      const { rows: o } = await audit.query<OrderRow>(
        `SELECT id, order_number, status::text, payment_method::text, payment_status::text,
                fulfillment_type::text, notified, subtotal::text, delivery_fee::text,
                total::text, delivery_address, outbound_msg_count,
                session_id, customer_id
           FROM orders WHERE restaurant_id = $1 ORDER BY created_at`,
        [restaurantId],
      );
      return o;
    },
  };
}

beforeAll(async () => {
  const url = process.env["MIGRATION_DATABASE_URL"];
  if (!url) throw new Error("MIGRATION_DATABASE_URL مفقود — انسخ .env.example");
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
    await audit.query("DELETE FROM restaurants WHERE id = ANY($1::uuid[])", [
      createdRestaurants,
    ]);
  }
  await audit.end();
});

// ---------------------------------------------------------------------------

describe("محادثة كاملة", () => {
  it("🔴 توصيل: طلب واحد، وأصنافه، وسطر تاريخ واحد، والجلسة order_placed", async () => {
    const s = await shop({
      label: "delivery",
      offersDelivery: true,
      deliveryFee: "1.50",
    });
    await s.say("1 ×2"); // 12.00
    await s.say("2"); //     2.50
    await s.say("تم");
    await s.say("توصيل");
    await s.say("الشميساني، شارع عبد الحميد شرف، بناية 12");
    replies.reset();

    expect(await s.say("أكّد")).toBe("cart_review");

    const [order] = await s.orders();
    expect(order).toBeDefined();
    expect(await s.orders()).toHaveLength(1);
    expect(order?.status).toBe("pending_acceptance");
    expect(order?.payment_method).toBe("cash");
    expect(order?.payment_status).toBe("pending_cash");
    expect(order?.fulfillment_type).toBe("delivery");
    expect(order?.delivery_address).toBe(
      "الشميساني، شارع عبد الحميد شرف، بناية 12",
    );
    // 🔴 القيد `total = subtotal + delivery_fee` مضبوط.
    expect(order?.subtotal).toBe("14.50");
    expect(order?.delivery_fee).toBe("1.50");
    expect(order?.total).toBe("16.00");

    const { rows: items } = await audit.query<{
      item_name_snapshot: string;
      unit_price_snapshot: string;
      quantity: number;
      restaurant_id: string;
      menu_item_id: string;
    }>(
      `SELECT item_name_snapshot, unit_price_snapshot::text, quantity,
              restaurant_id, menu_item_id
         FROM order_items WHERE order_id = $1 ORDER BY item_name_snapshot`,
      [order?.id],
    );
    expect(items).toHaveLength(2);
    // §15.1 — العمود موجود و NOT NULL، فبينتعبّى من `SessionData.cart[].name`.
    expect(items.map((i) => i.item_name_snapshot).sort()).toEqual(
      ["حمص", "شاورما عربي"].sort(),
    );
    expect(
      items.find((i) => i.item_name_snapshot === "شاورما عربي"),
    ).toMatchObject({ unit_price_snapshot: "6.00", quantity: 2 });
    // 🔴 `restaurant_id` على كل صف (ADR-002 §1).
    for (const item of items) {
      expect(item.restaurant_id).toBe(s.restaurantId);
    }

    const { rows: history } = await audit.query<{
      from_status: string | null;
      to_status: string;
      actor: string;
      actor_staff_id: string | null;
    }>(
      `SELECT from_status::text, to_status::text, actor::text, actor_staff_id
         FROM order_status_history WHERE order_id = $1`,
      [order?.id],
    );
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      from_status: null,
      to_status: "pending_acceptance",
      actor: "customer",
      actor_staff_id: null,
    });

    expect(await s.state()).toBe("order_placed");
    // بريف د §2.1: «استلمنا» صارت بالرقم — تغيّرت عمدا لأن نصها تغيّر.
    expect(s.last()).toBe(orderReceivedMessageAr(101));
    expect((await s.context())["order_id"]).toBe(order?.id);
    // §15.2 — العمود `session_id`.
    expect(order?.session_id).not.toBeNull();
  });

  it("استلام: رسوم صفر وعنوان NULL", async () => {
    const s = await shop({ label: "pickup" });
    await s.say("1");
    await s.say("تم");
    await s.say("أكّد");

    const [order] = await s.orders();
    expect(order?.fulfillment_type).toBe("pickup");
    expect(order?.delivery_fee).toBe("0.00");
    expect(order?.delivery_address).toBeNull();
    expect(order?.subtotal).toBe("6.00");
    expect(order?.total).toBe("6.00");
  });

  it("🔴 مبالغ بالفلوس: 1.25 × 3 مع رسوم 0.75 ← 3.75 و4.50 بالضبط", async () => {
    const s = await shop({
      label: "money",
      offersDelivery: true,
      deliveryFee: "0.75",
      items: [{ name: "فلافل", price: "1.25" }],
    });
    await s.say("1 ×3");
    await s.say("تم");
    await s.say("توصيل");
    await s.say("عمان");
    await s.say("أكّد");

    const [order] = await s.orders();
    // بالـfloat: 1.25*3 = 3.7500000000000004، والجمع مع 0.75 بيطلع 4.500000000000001.
    expect(order?.subtotal).toBe("3.75");
    expect(order?.delivery_fee).toBe("0.75");
    expect(order?.total).toBe("4.50");
  });

  it("`outbound_msg_count` = عدّاد الجلسة + 1", async () => {
    const s = await shop({ label: "outbound" });
    await s.say("1");
    await s.say("تم");
    const before = (await s.context())["outbound_count"] as number;

    await s.say("أكّد");

    const [order] = await s.orders();
    expect(order?.outbound_msg_count).toBe(before + 1);
    expect((await s.context())["outbound_count"]).toBe(before + 1);
  });
});

describe("التوفّر الحيّ — الخطوة 1", () => {
  it("🔴 صنف صار غير متوفر بين الملخّص و«أكّد»: لا طلب، وملخّص من جديد", async () => {
    const s = await shop({ label: "gone-one" });
    await s.say("1");
    await s.say("2");
    await s.say("تم");
    replies.reset();

    // المطعم خفّى «حمص» بعد ما الزبون شاف الملخّص.
    await audit.query(
      `UPDATE menu_items SET is_available = false WHERE id = $1`,
      [s.ids["حمص"]],
    );

    expect(await s.say("أكّد")).toBe("cart_review");

    expect(await s.orders()).toHaveLength(0);
    expect(await s.state()).toBe("cart_review");
    const sent = replies.forRestaurant(s.restaurantId).map((m) => m.body);
    expect(sent[0]).toBe(itemsRemovedUnavailableLineAr(["حمص"]));
    expect(sent[1]).toContain("ملخّص طلبك:");
    expect(sent[1]).toContain("المجموع 6.00 د.أ");
    expect(sent[1]).not.toContain("حمص");
    // السلّة المقلَّمة انكتبت.
    expect((await s.context())["cart"]).toHaveLength(1);
  });

  it("🔴 كل الأصناف سقطت: لا طلب، وbrowsing", async () => {
    const s = await shop({ label: "gone-all" });
    await s.say("1");
    await s.say("تم");
    replies.reset();

    await audit.query(
      `UPDATE menu_items SET is_available = false WHERE restaurant_id = $1`,
      [s.restaurantId],
    );

    await s.say("أكّد");

    expect(await s.orders()).toHaveLength(0);
    expect(await s.state()).toBe("browsing");
    const sent = replies.forRestaurant(s.restaurantId).map((m) => m.body);
    expect(sent[0]).toBe(itemsRemovedUnavailableLineAr(["شاورما عربي"]));
    expect(sent[1]).toBe(CART_EMPTY_AR);
    expect((await s.context())["cart"]).toEqual([]);
  });

  it("صف ممسوح كليا = غير متوفر", async () => {
    const s = await shop({ label: "deleted" });
    await s.say("1");
    await s.say("2");
    await s.say("تم");
    replies.reset();

    await audit.query(`DELETE FROM menu_items WHERE id = $1`, [s.ids["حمص"]]);

    await s.say("أكّد");

    expect(await s.orders()).toHaveLength(0);
    // الاسم من snapshot سطر السلّة — الصف ما عاد موجود (§16.1).
    expect(replies.forRestaurant(s.restaurantId)[0]?.body).toBe(
      itemsRemovedUnavailableLineAr(["حمص"]),
    );
  });
});

describe("الذرّية والعزل", () => {
  it("🔴 «أكّد» مرتين بمعرّفين مختلفين: طلب واحد بالضبط", async () => {
    const s = await shop({ label: "double" });
    await s.say("1");
    await s.say("تم");
    replies.reset();

    await s.say("أكّد");
    await s.say("أكّد");

    expect(await s.orders()).toHaveLength(1);
    // التانية ما وصلت المعالج أصلا — الحالة صارت `order_placed`.
    expect(
      replies
        .forRestaurant(s.restaurantId)
        .filter((m) => m.body === orderReceivedMessageAr(101)),
    ).toHaveLength(1);
  });

  /**
   * 🔴 **مرتَّب مش مسابَق** (نفس درس ب-5): الفائز بيمسك معاملته مفتوحة،
   *    فالخاسر بينحبس على `FOR UPDATE` فعلا. `Promise.all` بيمر أو بيسقط
   *    حسب حمل الجهاز.
   *
   * 🔴 **وهاد الاختبار هو اللي بيثبت إن الـCAS لازم، مش القفل وحده.**
   *    الاختبار المتسلسل فوقه ما بيميّز: هناك الرسالة التانية ما بتوصل
   *    المعالج أصلا لأن `findActiveSession` بتشوف `order_placed`. هون
   *    التنتين قرأتا الحالة **قبل** ما يقفل الفائز.
   */
  it("🔴 «أكّد» مرتين بالتزامن: طلب واحد بالضبط", async () => {
    const s = await shop({ label: "race" });
    await s.say("1");
    await s.say("تم");
    replies.reset();

    const ctx = {
      restaurantId: s.restaurantId,
      phoneNumberId: phoneId("race"),
      from: "", // بينتعبّى تحت
      body: "أكّد",
      deferred: [] as DeferredSend[],
    };
    const { rows: who } = await audit.query<{ phone_number: string }>(
      `SELECT phone_number FROM customers WHERE restaurant_id = $1`,
      [s.restaurantId],
    );
    ctx.from = who[0]?.phone_number ?? "";

    const winnerDb = new TenantDb();
    await winnerDb.start();
    let releaseWinner = (): void => {};
    const winnerHeld = new Promise<void>((resolve) => {
      releaseWinner = resolve;
    });
    const settle = (): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, 150));

    try {
      const winner = winnerDb.runInTenant(s.restaurantId, async (tx) => {
        await conversation.handleInbound(tx, ctx);
        await winnerHeld;
      });
      await settle();
      const loser = db.runInTenant(s.restaurantId, (tx) =>
        conversation.handleInbound(tx, ctx),
      );
      await settle();
      releaseWinner();
      await winner;
      await loser;
    } finally {
      releaseWinner();
      await winnerDb.stop();
    }

    expect(await s.orders()).toHaveLength(1);
    const { rows: history } = await audit.query(
      `SELECT 1 FROM order_status_history WHERE restaurant_id = $1`,
      [s.restaurantId],
    );
    expect(history).toHaveLength(1);
  });

  it("🔴 فشل مفروض بـorder_status_history: ولا صف بـorders، وصفر رسائل", async () => {
    const s = await shop({ label: "rollback" });
    await s.say("1");
    await s.say("تم");
    replies.reset();

    // فشل حقيقي من القاعدة نفسها، مش ثغرة اختبار بكود الإنتاج.
    await audit.query(`
      CREATE OR REPLACE FUNCTION sufria_test_block_history() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'فشل مفروض بالاختبار'; END;
      $$ LANGUAGE plpgsql`);
    await audit.query(`
      CREATE TRIGGER sufria_test_block_history_trg
      BEFORE INSERT ON order_status_history
      FOR EACH ROW WHEN (NEW.restaurant_id = '${s.restaurantId}')
      EXECUTE FUNCTION sufria_test_block_history()`);

    try {
      await expect(s.say("أكّد")).rejects.toThrow();

      // 🔴 الرسالة انبعثت بعد الـCOMMIT، والـCOMMIT ما صار. صفر رسائل.
      expect(s.sentCount()).toBe(0);
      expect(await s.orders()).toHaveLength(0);
      const { rows: items } = await audit.query(
        `SELECT 1 FROM order_items WHERE restaurant_id = $1`,
        [s.restaurantId],
      );
      expect(items).toHaveLength(0);
      // الجلسة رجعت مع المعاملة — الـCAS انسحب كمان.
      expect(await s.state()).toBe("cart_review");
    } finally {
      await audit.query(
        `DROP TRIGGER IF EXISTS sufria_test_block_history_trg ON order_status_history`,
      );
      await audit.query(`DROP FUNCTION IF EXISTS sufria_test_block_history()`);
    }
  });

  /**
   * 🔴 **هاد هو اللي بيحرس ترتيب الخطوة 7، مش اللي فوقه.**
   *
   *    اختبار الفشل المفروض فوق بيفجّر عند `order_status_history` — يعني
   *    **الخطوة 5، قبل نقطة الإرسال أصلا** — فنقل الإرسال جوّا المعاملة
   *    بيضل يمرّقه. اكتشفه ضابط كسر ج-5: كسرت الترتيب فما سقط ولا اختبار.
   *
   *    الفشل الوحيد اللي بيميّز هو فشل **عند الـCOMMIT نفسه**: كل الجمل
   *    نجحت، والمعاملة انسحبت بعدها. `CONSTRAINT TRIGGER … INITIALLY
   *    DEFERRED` بيصير بالضبط هيك. وقتها:
   *      - الترتيب الصح: الرسالة لسا بالطابور، والطابور ما بينفرّغ → صفر.
   *      - الترتيب الغلط: الرسالة راحت على واتساب قبل الـCOMMIT، و**ما
   *        بتنسحب معه** → الزبون ماسك «استلمنا طلبك» عن طلب مش موجود.
   */
  it("🔴 فشل عند الـCOMMIT: صفر رسائل — الزبون ما بياخد تأكيدا عن طلب وهمي", async () => {
    const s = await shop({ label: "commitfail" });
    await s.say("1");
    await s.say("تم");
    replies.reset();

    await audit.query(`
      CREATE OR REPLACE FUNCTION sufria_test_fail_at_commit() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'فشل مفروض عند الـCOMMIT'; END;
      $$ LANGUAGE plpgsql`);
    await audit.query(`
      CREATE CONSTRAINT TRIGGER sufria_test_fail_at_commit_trg
      AFTER INSERT ON orders
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW WHEN (NEW.restaurant_id = '${s.restaurantId}')
      EXECUTE FUNCTION sufria_test_fail_at_commit()`);

    try {
      await expect(s.say("أكّد")).rejects.toThrow();

      expect(s.sentCount()).toBe(0);
      expect(await s.orders()).toHaveLength(0);
      expect(await s.state()).toBe("cart_review");
    } finally {
      await audit.query(
        `DROP TRIGGER IF EXISTS sufria_test_fail_at_commit_trg ON orders`,
      );
      await audit.query(`DROP FUNCTION IF EXISTS sufria_test_fail_at_commit()`);
    }
  });

  it("🔴 العزل: طلب مطعم أ ما بينشاف تحت سياق مطعم ب", async () => {
    const a = await shop({ label: "iso-a" });
    const b = await shop({ label: "iso-b" });
    await a.say("1");
    await a.say("تم");
    await a.say("أكّد");

    const [order] = await a.orders();
    expect(order).toBeDefined();

    const seenFromB = await db.runInTenant(b.restaurantId, (tx) =>
      tx.execute(
        `SELECT id FROM orders WHERE id = '${order?.id ?? ""}'` as never,
      ),
    );
    expect((seenFromB as unknown as { rows: unknown[] }).rows).toHaveLength(0);
  });
});

describe("رقم الطلب — بريف د §2.1", () => {
  /** زبون تاني بنفس المطعم — رقمه وجلسته لحاله. */
  async function secondCustomer(
    s: Shop,
    label: string,
  ): Promise<{ from: string; say: (body: string) => Promise<string> }> {
    const from = nextCustomer();
    const say = async (body: string): Promise<string> => {
      const deferred: DeferredSend[] = [];
      const outcome = await db.runInTenant(s.restaurantId, (tx) =>
        conversation.handleInbound(tx, {
          restaurantId: s.restaurantId,
          phoneNumberId: phoneId(label),
          from,
          body,
          deferred,
        }),
      );
      await flushDeferred(conversation.sender, deferred);
      return outcome;
    };
    expect(await say("مرحبا")).toBe("greeted");
    return { from, say };
  }

  const numbersOf = async (s: Shop): Promise<number[]> =>
    (await s.orders()).map((o) => o.order_number).sort((a, b) => a - b);

  it("مطعم بلا طلبات: أول طلب 101، والتالي 102", async () => {
    const s = await shop({ label: "num-first" });
    await s.say("1");
    await s.say("تم");
    await s.say("أكّد");
    expect(await numbersOf(s)).toEqual([101]);

    // `order_placed` حالة مغلقة، فالرسالة الجاية بتفتح جلسة جديدة (§16.8).
    expect(await s.say("مرحبا")).toBe("greeted");
    await s.say("2");
    await s.say("تم");
    await s.say("أكّد");

    expect(await numbersOf(s)).toEqual([101, 102]);
    expect(s.last()).toBe(orderReceivedMessageAr(102));
  });

  it("مطعمان: أول طلب بكل واحد منهم 101 — العدّاد لكل مطعم، مش عام", async () => {
    const a = await shop({ label: "num-a" });
    const b = await shop({ label: "num-b" });
    for (const s of [a, b]) {
      await s.say("1");
      await s.say("تم");
      await s.say("أكّد");
    }

    expect(await numbersOf(a)).toEqual([101]);
    expect(await numbersOf(b)).toEqual([101]);
  });

  it("«استلمنا» فيها الرقم المخزَّن نفسه — مش 101 ثابتة", async () => {
    const s = await shop({ label: "num-stored" });
    // طلب قائم برقم 257: الجاي 258. رقم ثابت بالرسالة، أو محسوب بمكان تاني
    // غير الصف، بيطلع هون.
    const { rows: who } = await audit.query<{ id: string }>(
      `SELECT id FROM customers WHERE restaurant_id = $1`,
      [s.restaurantId],
    );
    await audit.query(
      `INSERT INTO orders (restaurant_id, customer_id, order_number, fulfillment_type,
                           payment_method, status, payment_status, subtotal, total)
       VALUES ($1, $2, 257, 'pickup', 'cash', 'completed', 'collected', 1.00, 1.00)`,
      [s.restaurantId, who[0]?.id],
    );

    await s.say("1");
    await s.say("تم");
    await s.say("أكّد");

    const created = (await s.orders()).find((o) => o.order_number !== 257);
    expect(created?.order_number).toBe(258);
    expect(s.last()).toBe(orderReceivedMessageAr(created?.order_number ?? 0));
    expect(s.last()).toBe("استلمنا طلبك رقم 258 — التأكيد خلال دقائق.");
  });

  /**
   * 🔴 **مرتَّب مش مسابَق** — نفس شكل «أكّد مرتين بالتزامن» فوق: الأول بيمسك
   *    معاملته مفتوحة **بعد** ما خصّص رقمه وكتب طلبه، والتاني بيبلّش وقتها.
   *    `Promise.all` بيخلّي الاتنين يمرقوا ورا بعض على جهاز فاضي، فالاختبار
   *    بيمر حتى بلا قفل.
   *
   *    زبونين مختلفين = جلستين مختلفتين، فما في `FOR UPDATE` ولا CAS مشترك
   *    بينهم. الشي الوحيد اللي بيسلسلهم هو قفل رقم الطلب — وهاد اللي بيتفحص.
   */
  it("🔴 طلبان لزبونين مختلفين بنفس المطعم بالتزامن: الاتنين بينخلقوا، برقمين متتاليين", async () => {
    const label = "num-race";
    const s = await shop({ label });
    const other = await secondCustomer(s, label);
    for (const say of [s.say, other.say]) {
      await say("1");
      await say("تم");
    }
    replies.reset();

    const confirmAs = (from: string, deferred: DeferredSend[]) => ({
      restaurantId: s.restaurantId,
      phoneNumberId: phoneId(label),
      from,
      body: "أكّد",
      deferred,
    });
    const winnerSends: DeferredSend[] = [];
    const loserSends: DeferredSend[] = [];

    const winnerDb = new TenantDb();
    await winnerDb.start();
    let releaseWinner = (): void => {};
    const winnerHeld = new Promise<void>((resolve) => {
      releaseWinner = resolve;
    });
    const settle = (): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, 150));

    let loserWaitedOnLock: boolean;
    let settled: PromiseSettledResult<unknown>[];
    try {
      const winner = winnerDb.runInTenant(s.restaurantId, async (tx) => {
        await conversation.handleInbound(tx, confirmAs(s.from, winnerSends));
        await winnerHeld;
      });
      await settle();
      const loser = db.runInTenant(s.restaurantId, (tx) =>
        conversation.handleInbound(tx, confirmAs(other.from, loserSends)),
      );
      await settle();
      // لقطة والأول لسا ماسك: التاني واقف على القفل الاستشاري (11 = الـnamespace
      // بـorder-creation.ts، و`objsubid = 2` = الشكل بمفتاحين int4).
      const { rows: waiting } = await audit.query(
        `SELECT 1 FROM pg_locks
          WHERE locktype = 'advisory' AND classid = 11 AND objsubid = 2
            AND NOT granted
            AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
      );
      loserWaitedOnLock = waiting.length === 1;
      releaseWinner();
      settled = await Promise.allSettled([winner, loser]);
    } finally {
      releaseWinner();
      await winnerDb.stop();
    }

    // ١. الاتنين انخلقوا — ولا «أكّد» ضاعت عالقيد الفريد. السبب بينطبع
    //    بالفشل، عشان ضابط الكسر يبيّن **ليش** سقط، مش بس إنه سقط.
    const rejections = settled.flatMap((r) =>
      r.status === "rejected"
        ? [
            String(
              (r.reason as { cause?: { message?: string } }).cause?.message ??
                r.reason,
            ),
          ]
        : [],
    );
    expect(rejections).toEqual([]);
    // ٢. برقمين مختلفين متتاليين، وكل زبون وصله رقمه هو.
    expect(await numbersOf(s)).toEqual([101, 102]);
    expect(winnerSends.map((m) => m.body)).toEqual([
      orderReceivedMessageAr(101),
    ]);
    expect(loserSends.map((m) => m.body)).toEqual([
      orderReceivedMessageAr(102),
    ]);
    // ٣. 🔴 دليل إن التزامن صار فعلا، مش إنهم مرقوا ورا بعض. آخر شي بالقصد:
    //    لو القفل انشال، الاختبار لازم يسقط عند ١ (القيد رفض التاني) — مش هون.
    expect(loserWaitedOnLock).toBe(true);
  });
});

describe("العملة — بريف د §2.2 و§8.4", () => {
  /**
   * محادثة بتمرق على **كل** نص فيه مبلغ، بكل مسار بيرسمه: الترحيب مع المنيو
   * (`session.service`)، «منيو» (`browsing`)، الإضافة، «سلة»، سؤال الرسوم،
   * الملخّص (`fulfillment`)، «عدّل» من الملخّص (`cart-review`)، والملخّص
   * مرة تانية، و«استلمنا». بترجّع كل نص صادر بالترتيب، والترحيب أوله.
   */
  async function converse(
    label: string,
    currency?: "JOD" | "ILS",
  ): Promise<{ s: Shop; bodies: string[] }> {
    const s = await shop({
      label,
      currency,
      offersDelivery: true,
      deliveryFee: "5.00",
      items: [
        { name: "شاورما دجاج", price: "12.00" },
        { name: "حمص", price: "8.50" },
      ],
    });
    for (const body of [
      "منيو",
      "1 ×2",
      "2",
      "سلة",
      "تم",
      "توصيل",
      "غزة، شارع الوحدة، بناية 3",
      "عدّل",
      "تم",
      "أكّد",
    ]) {
      await s.say(body);
    }
    expect(await s.orders()).toHaveLength(1);
    return {
      s,
      bodies: [
        s.greeting,
        ...replies.forRestaurant(s.restaurantId).map((m) => m.body),
      ],
    };
  }

  /** كل سطر فيه مبلغ (رقم بمنزلتين) لازم يحمل تسمية العملة. */
  const amountLines = (bodies: readonly string[]): string[] =>
    bodies.flatMap((b) => b.split("\n")).filter((l) => /\d\.\d{2}\b/u.test(l));

  it("🔴 مطعم ILS: المنيو والسلّة والملخّص وسؤال الرسوم كلها بـ«شيكل»، ولا «د.أ» بأي نص صادر", async () => {
    const { bodies } = await converse("cur-ils", "ILS");

    for (const body of bodies) expect(body).not.toContain("د.أ");
    const lines = amountLines(bodies);
    // المنيو مرتين بسطرين، والإضافة مرتين، والسلّة مرتين، والرسوم، والملخّص مرتين.
    expect(lines.length).toBeGreaterThanOrEqual(15);
    for (const line of lines) expect(line).toContain("شيكل");

    const all = bodies.join("\n").split("\n");
    // المنيو — الترحيب و«منيو».
    expect(bodies[0]).toContain("1. شاورما دجاج — 12.00 شيكل\n");
    expect(bodies[1]).toContain("2. حمص — 8.50 شيكل\n");
    // الإضافة والسلّة.
    expect(all).toContain("أضفت: شاورما دجاج ×2 — المجموع 24.00 شيكل");
    expect(all).toContain("1 · شاورما دجاج ×2 — 24.00 شيكل");
    expect(all).toContain("المجموع 32.50 شيكل");
    // سؤال الرسوم، حرفيا.
    expect(bodies).toContain(fulfillmentAskAr(500, "ILS"));
    // الملخّص.
    expect(all).toContain("التوصيل — 5.00 شيكل");
    expect(all).toContain("المجموع 37.50 شيكل");
    expect(all).toContain("الدفع نقدا.");
    expect(bodies.at(-1)).toBe(orderReceivedMessageAr(101));
  });

  it("مطعم بلا عملة مسمّاة (افتراضي القاعدة JOD): نفس المحادثة بـ«د.أ»، ولا «شيكل»", async () => {
    const { bodies } = await converse("cur-jod");

    for (const body of bodies) expect(body).not.toContain("شيكل");
    const lines = amountLines(bodies);
    expect(lines.length).toBeGreaterThanOrEqual(15);
    for (const line of lines) expect(line).toContain("د.أ");
    expect(bodies[0]).toContain("1. شاورما دجاج — 12.00 د.أ\n");
    expect(bodies).toContain(fulfillmentAskAr(500, "JOD"));
  });

  it("🔴 ولا نص صادر فيه خانة ما انعبّت ولا «{» — بالعملتين", async () => {
    for (const [label, currency] of [
      ["slots-jod", "JOD"],
      ["slots-ils", "ILS"],
    ] as const) {
      const { bodies } = await converse(label, currency);
      for (const body of bodies) {
        expect(body).not.toMatch(/\[[^\]]*\]/u);
        expect(body).not.toContain("{");
      }
    }
  });
});

describe("الثابت المكسور — الخطوة 0", () => {
  it("«أكّد» وطريقة الاستلام ناقصة: رجوع لسؤال الاستلام، ولا طلب", async () => {
    const s = await shop({
      label: "broken",
      offersDelivery: true,
      deliveryFee: "1.50",
    });
    await s.say("1");
    await s.say("تم");
    await s.say("استلام");
    expect(await s.state()).toBe("cart_review");

    // كسر الثابت بالقاعدة مباشرة: `cart_review` بلا طريقة استلام.
    await audit.query(
      `UPDATE conversation_sessions SET context = context - 'fulfillment'
        WHERE restaurant_id = $1`,
      [s.restaurantId],
    );
    replies.reset();

    await s.say("أكّد");

    expect(await s.orders()).toHaveLength(0);
    expect(await s.state()).toBe("fulfillment_choice");
    expect(s.last()).toBe(fulfillmentAskAr(150, "JOD"));
  });
});
