/**
 * ح-2 · مهلة الجلسة — على قاعدة حقيقية، بالمرسِل الوهمي.
 *
 * المواصفة: بريف ح (`docs/17-session-timeout-brief.md`) §2 و§3. الأرقام بأسماء
 * الاختبارات هي أرقام جدول §3، و9 زيادة: بيحرس قاعدة §0 «الوقت من القاعدة».
 *
 * الجلسة بتنعمل بالمسار الحقيقي (`handleInbound`)، وبعدين بتنشاخ بـ`UPDATE`
 * على `last_message_at` من اتصال التدقيق: `now() - interval` بساعة القاعدة،
 * نفس الساعة اللي بتقرأها المهلة. التحقق بيقرأ `state` و`context` من القاعدة
 * فوق RLS — مش من نفس الكود اللي كتبهم.
 *
 * 🔴 الحد (60:00 بالضبط) بينفحص على `isSessionExpired` بأرقام ثابتة، مش على
 *    القاعدة: ساعة القاعدة بتمشي بين تجهيز الاختبار والفحص، فجلسة «60:00»
 *    بتوصل 60:00.05 — وبتنتهي بـ`>` و`>=` سوا، والاختبار ما بيفرّق بينهم.
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
  FULFILLMENT_PROMPT_AR,
  MENU_HEADER_AR,
  handoffMessageAr,
  welcomeMessageAr,
} from "@sufria/shared";

import {
  ConversationService,
  flushDeferred,
  type DeferredSend,
} from "../src/conversation/session.service.js";
import { isSessionExpired } from "../src/conversation/session-idle.js";
import { TenantDb } from "../src/db/tenant-db.js";
import { RecordingWhatsAppSender } from "../src/whatsapp/sender.js";

const RUN = randomUUID();
const phoneId = (label: string): string => `PHONE.IDLE.${RUN}.${label}`;
const NAME = `مطعم المهلة ${RUN}`;

let customerSeq = 0;
const nextCustomer = (): string =>
  `96278${String(++customerSeq).padStart(7, "0")}`;

/** `{}` = مفتوح دايما — المسار الموثّق الوحيد لمطعم 24 ساعة (شوف `fulfillment.test.ts`). */
const ALWAYS_OPEN_HOURS = {};
const PHONE = "0790000456";

let db: TenantDb;
let audit: Pool;
let replies: RecordingWhatsAppSender;
let conversation: ConversationService;
const createdRestaurants: string[] = [];

interface SessionRow {
  id: string;
  state: string;
  context: Record<string, unknown>;
  /** نص، مش `Date`: المقارنة بالميكروثانية، و`Date` بتقصّها لملّي. */
  lastMessageAt: string;
}

interface Shop {
  restaurantId: string;
  pid: string;
  from: string;
  say: (body: string, service?: ConversationService) => Promise<string>;
  sessions: () => Promise<SessionRow[]>;
  active: () => Promise<SessionRow>;
  replies: () => string[];
}

/** مطعم مفتوح بصنفين، وزبون لسا ما بعت إشي. */
async function shop(opts: {
  label: string;
  offersDelivery: boolean;
  from?: string;
}): Promise<Shop> {
  const pid = phoneId(opts.label);
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status, business_hours,
                              contact_phone, offers_delivery, delivery_fee)
     VALUES ($1, $2, 'active'::restaurant_status, $3::jsonb, $4, $5, '1.50')
     RETURNING id`,
    [NAME, pid, JSON.stringify(ALWAYS_OPEN_HOURS), PHONE, opts.offersDelivery],
  );
  const restaurantId = rows[0]?.id ?? "";
  createdRestaurants.push(restaurantId);

  const cat = await audit.query<{ id: string }>(
    `INSERT INTO menu_categories (restaurant_id, name) VALUES ($1, 'مقبلات') RETURNING id`,
    [restaurantId],
  );
  for (const [i, item] of [
    { name: "شاورما عربي", price: "6.00" },
    { name: "حمص", price: "2.50" },
  ].entries()) {
    await audit.query(
      `INSERT INTO menu_items (restaurant_id, category_id, name, price, display_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [restaurantId, cat.rows[0]?.id, item.name, item.price, i],
    );
  }

  const from = opts.from ?? nextCustomer();

  /** رسالة كاملة زي الـwebhook: معاملة، **وبعدها** طابور ما بعد الـCOMMIT. */
  const say = async (
    body: string,
    service: ConversationService = conversation,
  ): Promise<string> => {
    const deferred: DeferredSend[] = [];
    const outcome = await db.runInTenant(restaurantId, (tx) =>
      service.handleInbound(tx, {
        restaurantId,
        phoneNumberId: pid,
        from,
        body,
        deferred,
      }),
    );
    await flushDeferred(service.sender, deferred);
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
    pid,
    from,
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
  };
}

/** بترجّع `last_message_at` لورا بساعة القاعدة — نفس الساعة اللي بتقرأها المهلة. */
async function age(sessionId: string, interval: string): Promise<void> {
  const { rowCount } = await audit.query(
    `UPDATE conversation_sessions
        SET last_message_at = now() - $2::interval
      WHERE id = $1`,
    [sessionId, interval],
  );
  expect(rowCount).toBe(1);
}

/** الترحيب والمنيو برسالة وحدة — زي ما بيبعتهم `deliverMenu`. */
function isWelcomeAndMenu(body: string | undefined): boolean {
  return (
    body !== undefined &&
    body.startsWith(welcomeMessageAr(NAME)) &&
    body.includes(MENU_HEADER_AR) &&
    body.includes("شاورما عربي")
  );
}

function welcomes(s: Shop): number {
  return s.replies().filter((b) => b.startsWith(welcomeMessageAr(NAME))).length;
}

/** بتسيب حلقة الأحداث تمشي كفاية لمعاملة تانية توصل لمكانها وتنحبس. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

/** زبون استلم المنيو، وحطّ صنفين، وقال «تم» — واقف عند «استلام ولا توصيل؟». */
async function atFulfillmentChoice(label: string): Promise<Shop> {
  const s = await shop({ label, offersDelivery: true });
  expect(await s.say("مرحبا")).toBe("greeted");
  await s.say("1 ×2");
  await s.say("2");
  await s.say("تم");
  expect((await s.active()).state).toBe("fulfillment_choice");
  replies.reset();
  return s;
}

beforeAll(async () => {
  const url = process.env["MIGRATION_DATABASE_URL"];
  if (!url) throw new Error("MIGRATION_DATABASE_URL مفقود — انسخ .env.example");
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
    // cascade بيمسح الزبائن والجلسات والطلبات معهم.
    await audit.query("DELETE FROM restaurants WHERE id = ANY($1::uuid[])", [
      createdRestaurants,
    ]);
  }
  await audit.end();
});

// ---------------------------------------------------------------------------

describe("الانتهاء — بريف ح §3", () => {
  it("1. `fulfillment_choice` سكتت 61 دقيقة + «مرحبا» ← القديمة `abandoned` · جديدة `browsing` · ترحيب ومنيو", async () => {
    const s = await atFulfillmentChoice("t1");
    const old = await s.active();
    await age(old.id, "61 minutes");

    expect(await s.say("مرحبا")).toBe("greeted");

    const [first, second] = await s.sessions();
    expect(first?.id).toBe(old.id);
    expect(first?.state).toBe("abandoned");
    expect(second?.state).toBe("browsing");
    expect(s.replies()).toHaveLength(1);
    expect(isWelcomeAndMenu(s.replies()[0])).toBe(true);
  });

  it("2. نفس الشي بـ59 دقيقة + «استلام» ← السلوك القائم: الملخّص، ونفس الجلسة", async () => {
    const s = await atFulfillmentChoice("t2");
    const old = await s.active();
    await age(old.id, "59 minutes");

    expect(await s.say("استلام")).toBe("fulfillment_choice");

    const all = await s.sessions();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(old.id);
    expect(all[0]?.state).toBe("cart_review");
    expect(s.replies()).toHaveLength(1);
    expect(s.replies()[0]).toContain("ملخّص طلبك:");
    expect(s.replies()[0]).toContain("الاستلام من المطعم");
    expect(welcomes(s)).toBe(0);
  });

  it("3. الحد: 59:59 ← ما بتنتهي · 60:00 ← بتنتهي", () => {
    expect(isSessionExpired(59 * 60 + 59, 60)).toBe(false);
    // كسر الثانية ما بيقرّب لفوق: 59:59.999 لسا جوّا المهلة.
    expect(isSessionExpired(3599.999, 60)).toBe(false);
    expect(isSessionExpired(60 * 60, 60)).toBe(true);
    expect(isSessionExpired(60 * 60 + 1, 60)).toBe(true);
    // ونفس الحد بمهلة محمد التجريبية (`SESSION_IDLE_MINUTES=1`).
    expect(isSessionExpired(59, 1)).toBe(false);
    expect(isSessionExpired(60, 1)).toBe(true);
  });

  it("4. 🔴 العطل الحقيقي: العدّاد خالص بعد رسالة الاستسلام، ساعتين سكوت، «1» ← ترحيب ومنيو، مش صمت", async () => {
    const s = await atFulfillmentChoice("t4");

    await s.say("شو يعني؟");
    expect(s.replies().at(-1)).toBe(FULFILLMENT_PROMPT_AR);
    await s.say("ما فهمت");
    await s.say("مرحبا");
    expect(s.replies().at(-1)).toBe(handoffMessageAr(PHONE));

    // الشرط المسبق — العطل نفسه: بعد الاستسلام «1» بتاخد صمتا.
    replies.reset();
    expect(await s.say("1")).toBe("fulfillment_choice");
    expect(s.replies()).toEqual([]);

    const old = await s.active();
    await age(old.id, "2 hours");

    expect(await s.say("1")).toBe("greeted");
    expect(s.replies()).toHaveLength(1);
    expect(isWelcomeAndMenu(s.replies()[0])).toBe(true);
    expect((await s.active()).state).toBe("browsing");
  });

  it("5. السلّة ما بتنتقل: الجديدة فاضية · القديمة محفوظة كما هي بحالة `abandoned`", async () => {
    const s = await atFulfillmentChoice("t5");
    await s.say("توصيل");
    await s.say("الشميساني، شارع عبد الحميد شرف، بناية 12");
    const old = await s.active();
    expect(old.state).toBe("cart_review");
    await age(old.id, "61 minutes");
    // اللقطة **بعد** التشييخ: هاي الحالة اللي لازم تضل كما هي.
    const [before] = await s.sessions();
    expect((before?.context["cart"] as unknown[]).length).toBe(2);
    expect(before?.context["fulfillment"]).toEqual({
      type: "delivery",
      fee_minor: 150,
      address: "الشميساني، شارع عبد الحميد شرف، بناية 12",
    });

    expect(await s.say("مرحبا")).toBe("greeted");

    const [after, fresh] = await s.sessions();
    expect(after?.state).toBe("abandoned");
    expect(after?.context).toEqual(before?.context);
    expect(after?.lastMessageAt).toBe(before?.lastMessageAt);

    expect(fresh?.state).toBe("browsing");
    expect(fresh?.context["cart"]).toEqual([]);
    expect(fresh?.context["fulfillment"]).toBeUndefined();
    expect(fresh?.context["unparsed_streak"]).toBe(0);
    expect(fresh?.context["handoff_sent"]).toBe(false);
  });

  it("6. الطلب ما بيتأثر: طلب `pending_acceptance` من جلسة `order_placed`، وجلسة بعدها انتهت", async () => {
    const s = await shop({ label: "t6", offersDelivery: false });
    await s.say("مرحبا");
    await s.say("1");
    await s.say("تم");
    await s.say("أكّد");
    const [placed] = await s.sessions();
    expect(placed?.state).toBe("order_placed");

    const orderRow = async (): Promise<Record<string, unknown>[]> => {
      const { rows } = await audit.query<{ o: Record<string, unknown> }>(
        `SELECT to_jsonb(o) AS o FROM orders o WHERE o.restaurant_id = $1`,
        [s.restaurantId],
      );
      return rows.map((r) => r.o);
    };
    const ordersBefore = await orderRow();
    expect(ordersBefore).toHaveLength(1);
    expect(ordersBefore[0]?.["status"]).toBe("pending_acceptance");

    // الرسالة بعد الطلب بتفتح جلسة جديدة (السلوك القائم)، وهاي اللي بتنتهي.
    expect(await s.say("مرحبا")).toBe("greeted");
    const browsing = await s.active();
    await age(placed?.id ?? "", "2 hours");
    await age(browsing.id, "2 hours");

    expect(await s.say("مرحبا")).toBe("greeted");

    expect(await orderRow()).toEqual(ordersBefore);
    const states = (await s.sessions()).map((x) => x.state);
    expect(states).toEqual(["order_placed", "abandoned", "browsing"]);
  });

  it("7. 🔴 رسالتين بنفس اللحظة بعد الانتهاء ← جلسة نشطة وحدة، وترحيب واحد", async () => {
    // مرتّب مش سباق (CLAUDE.md): الفائز بيمشي المسار الحقيقي كاملا — انتهاء،
    // جلسة جديدة، ترحيب — وبيمسك معاملته مفتوحة. الخاسر بيقرأ الجلسة القديمة
    // لسا نشطة ومنتهية، وبينحبس على قفل صفها بـCAS الانتهاء. بعد الـCOMMIT:
    // CAS الانتهاء صفر صفوف ← مسار الجلسة الجديدة ← تعارض على فهرس 0007 ←
    // CAS الترحيب خسر ← سكوت.
    const s = await atFulfillmentChoice("t7");
    const old = await s.active();
    await age(old.id, "61 minutes");

    const ctx = {
      restaurantId: s.restaurantId,
      phoneNumberId: s.pid,
      from: s.from,
      body: "مرحبا",
      deferred: [],
    };

    const winnerDb = new TenantDb();
    let releaseWinner = (): void => {};
    const winnerHeld = new Promise<void>((resolve) => {
      releaseWinner = resolve;
    });

    try {
      const winner = winnerDb.runInTenant(s.restaurantId, async (tx) => {
        const outcome = await conversation.handleInbound(tx, ctx);
        await winnerHeld;
        return outcome;
      });

      await settle();

      const loser = db.runInTenant(s.restaurantId, (tx) =>
        conversation.handleInbound(tx, { ...ctx, deferred: [] }),
      );

      await settle();
      releaseWinner();

      await expect(winner).resolves.toBe("greeted");
      await expect(loser).resolves.toBe("duplicate_ignored");
    } finally {
      releaseWinner();
      await winnerDb.stop();
    }

    const states = (await s.sessions()).map((x) => x.state);
    expect(states).toEqual(["abandoned", "browsing"]);
    expect(welcomes(s)).toBe(1);
  });

  it("8. مطعمين: انتهاء جلسة عند مطعم أ ما بيلمس جلسة نفس الرقم عند مطعم ب", async () => {
    const a = await shop({ label: "t8-a", offersDelivery: false });
    const b = await shop({
      label: "t8-b",
      offersDelivery: false,
      from: a.from,
    });
    await a.say("مرحبا");
    await a.say("1");
    await b.say("مرحبا");
    await b.say("2");

    // الاتنتين منتهيتين بالعمر — فأي تسريب بين المستأجرين بيبان على ب.
    await age((await a.active()).id, "61 minutes");
    await age((await b.active()).id, "61 minutes");
    const [bBefore] = await b.sessions();
    replies.reset();

    expect(await a.say("مرحبا")).toBe("greeted");

    expect((await a.sessions()).map((x) => x.state)).toEqual([
      "abandoned",
      "browsing",
    ]);
    expect(await b.sessions()).toEqual([bBefore]);
    expect(b.replies()).toEqual([]);
  });

  it("9. 🔴 السكوت بساعة القاعدة، مش بالساعة المحقونة (بريف ح §0)", async () => {
    const day = 24 * 60 * 60 * 1000;
    const pastClock = new ConversationService(
      replies,
      () => new Date(Date.now() - 30 * day),
    );
    const futureClock = new ConversationService(
      replies,
      () => new Date(Date.now() + 30 * day),
    );

    // ساعة Node متأخرة شهرا: بحسابها السكوت سالب. بساعة القاعدة 61 دقيقة ← بتنتهي.
    const late = await shop({ label: "t9-late", offersDelivery: false });
    await late.say("مرحبا");
    await age((await late.active()).id, "61 minutes");
    expect(await late.say("مرحبا", pastClock)).toBe("greeted");

    // ساعة Node متقدّمة شهرا: بحسابها شهر سكوت. بساعة القاعدة 10 دقايق ← بتضل.
    const early = await shop({ label: "t9-early", offersDelivery: false });
    await early.say("مرحبا");
    await age((await early.active()).id, "10 minutes");
    expect(await early.say("مرحبا", futureClock)).toBe("browsing");
    expect(await early.sessions()).toHaveLength(1);
  });
});
