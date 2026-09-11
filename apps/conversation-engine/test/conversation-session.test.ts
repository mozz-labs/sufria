/**
 * الجلسة + أول رد + بوابة ساعات الدوام — اختبارات على قاعدة حقيقية.
 *
 * ولا mock لقاعدة البيانات، ولا نداء واحد لـGraph API. الإرسال الصادر بيمر من
 * RecordingWhatsAppSender، وهو نفس صنف الواجهة اللي بيستعمله الحقيقي وبنفس فحص
 * السقف — فاختبار بيمر عليه بيعني إشي عن MetaWhatsAppSender.
 *
 * الخصائص اللي هالسويت موجودة عشانها:
 *   1. مطعم مغلق: ولا جلسة، ورسالة الإغلاق وبس.
 *   2. مطعم مفتوح: جلسة وحدة، وترحيب وقائمة.
 *   3. رسالتين بسرعة: جلسة وحدة مش اتنتين — الفهرس الفريد بـ0007 والـCAS.
 *   4. الجلسة تحت المطعم الصح — بينسأل من اتصال تدقيق منفصل، فوق RLS.
 *   5. ولا رسالة صادرة بتروح لمطعم تاني.
 *
 * البيانات كلها بتتعمل بهالملف عبر اتصال التدقيق: ساعات الدوام والقوائم لازم
 * تتغيّر بنص الاختبار، وتعديل صفوف الـfixture المشتركة بيكسر باقي السويتات.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { createHmac, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Pool } from "pg";
import {
  CLOSED_AR,
  MENU_HEADER_AR,
  closedMessageAr,
  conversationSessions,
  welcomeMessageAr,
} from "@sufria/shared";

import { env } from "../src/config/env.js";
import { ConversationService } from "../src/conversation/session.service.js";
import { advanceSessionState } from "../src/db/critical-primitives.js";
import { TenantDb } from "../src/db/tenant-db.js";
import { createWebhookServer, WEBHOOK_PATH } from "../src/http/server.js";
import { decideHours } from "../src/restaurant/business-hours.js";
import { buildMenu } from "../src/restaurant/menu.js";
import {
  RecordingWhatsAppSender,
  WHATSAPP_TEXT_LIMIT,
} from "../src/whatsapp/sender.js";
import { WebhookService } from "../src/whatsapp/webhook.service.js";

const RUN = randomUUID();
const wamid = (label: string): string => `wamid.SESSION.${RUN}.${label}`;
const phoneId = (label: string): string => `PHONE.SESSION.${RUN}.${label}`;

/** رقم زبون فريد لكل اختبار: الجلسة مفتاحها (مطعم، زبون). */
let customerSeq = 0;
const nextCustomer = (): string =>
  `96279${String(++customerSeq).padStart(7, "0")}`;

/** دوام يغطي اليوم كله بكل أيام الأسبوع — "مفتوح" بلا الاعتماد على الساعة. */
const ALWAYS_OPEN_HOURS = {
  timezone: "Asia/Amman",
  days: Object.fromEntries(
    ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((d) => [
      d,
      [{ open: "00:00", close: "23:59" }],
    ]),
  ),
};

/** ولا يوم مفتوح — "مغلق" بلا الاعتماد على الساعة. */
const ALWAYS_CLOSED_HOURS = {
  timezone: "Asia/Amman",
  days: { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] },
};

let db: TenantDb;
let audit: Pool;
let replies: RecordingWhatsAppSender;
let conversation: ConversationService;
let server: Server;
let baseUrl: string;

const createdRestaurants: string[] = [];

function auditPool(): Pool {
  const url = process.env["MIGRATION_DATABASE_URL"];
  if (!url) {
    throw new Error(
      "MIGRATION_DATABASE_URL مفقود — الاختبار بيحتاجه ليسأل فوق RLS. انسخ .env.example لـ.env.",
    );
  }
  return new Pool({ connectionString: url, max: 2 });
}

interface RestaurantOpts {
  phoneNumberId: string;
  businessHours?: unknown;
  name?: string;
}

async function createRestaurant(opts: RestaurantOpts): Promise<string> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status, business_hours)
     VALUES ($1, $2, 'active'::restaurant_status, $3::jsonb) RETURNING id`,
    [
      opts.name ?? `مطعم ${RUN}`,
      opts.phoneNumberId,
      JSON.stringify(opts.businessHours ?? ALWAYS_OPEN_HOURS),
    ],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("ما انكتب صف مطعم");
  createdRestaurants.push(id);
  return id;
}

/** تصنيف واحد وأصنافه. بينكتب باتصال التدقيق — تجهيز، مش مسار تطبيق. */
const categoryOrder = new Map<string, number>();

async function addCategory(
  restaurantId: string,
  categoryName: string,
  items: { name: string; price: string }[],
): Promise<void> {
  // ترتيب صريح لكل تصنيف، زي ما المطعم بيرتّب قائمته. بلاه بيوقعوا كلهم على
  // display_order = 0 وبيصير الترتيب معتمدا على فاصل التعادل — وهاد بينفحص
  // باختباره لحاله تحت.
  const order = categoryOrder.get(restaurantId) ?? 0;
  categoryOrder.set(restaurantId, order + 1);

  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO menu_categories (restaurant_id, name, display_order)
     VALUES ($1, $2, $3) RETURNING id`,
    [restaurantId, categoryName, order],
  );
  const categoryId = rows[0]?.id;
  if (categoryId === undefined) throw new Error("ما انكتب تصنيف");

  for (const [i, item] of items.entries()) {
    await audit.query(
      `INSERT INTO menu_items (restaurant_id, category_id, name, price, display_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [restaurantId, categoryId, item.name, item.price, i],
    );
  }
}

// --- قراءات التحقق، كلها فوق RLS -------------------------------------------

/** كل الجلسات لهالمطعم. اتصال التدقيق بيشوف كل المستأجرين. */
async function sessionsOf(
  restaurantId: string,
): Promise<{ id: string; state: string; customerId: string }[]> {
  const { rows } = await audit.query<{
    id: string;
    state: string;
    customer_id: string;
  }>(
    `SELECT id, state::text AS state, customer_id
       FROM conversation_sessions WHERE restaurant_id = $1`,
    [restaurantId],
  );
  return rows.map((r) => ({
    id: r.id,
    state: r.state,
    customerId: r.customer_id,
  }));
}

/**
 * 🔴 السؤال اللي ما بينسأل من جوّا RLS: هل انفتحت جلسة لهالرقم عند **أي**
 *    مطعم غير اللي بنتوقعه؟ دور sufria_engine بيشوف سياقه وبس، فـ"ما شفت صف"
 *    منه بتحتمل "ما انكتب" و"انكتب عند غيري وأنا ممنوع أشوفه" — والتاني هو
 *    العطل اللي عم نختبره.
 */
async function sessionRestaurantsFor(phone: string): Promise<string[]> {
  const { rows } = await audit.query<{ restaurant_id: string }>(
    `SELECT s.restaurant_id
       FROM conversation_sessions s
       JOIN customers c ON c.id = s.customer_id
      WHERE c.phone_number = $1`,
    [phone],
  );
  return rows.map((r) => r.restaurant_id);
}

// --- حمولة ميتا -------------------------------------------------------------

interface MessageOpts {
  phoneNumberId: string;
  waMessageId: string;
  from: string;
  text?: string;
}

function metaPayload(...messages: MessageOpts[]): Record<string, unknown> {
  const byPhoneId = new Map<string, MessageOpts[]>();
  for (const m of messages) {
    const bucket = byPhoneId.get(m.phoneNumberId) ?? [];
    bucket.push(m);
    byPhoneId.set(m.phoneNumberId, bucket);
  }
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_TEST",
        changes: [...byPhoneId.entries()].map(([pid, bucket]) => ({
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "962790000000",
              phone_number_id: pid,
            },
            messages: bucket.map((m) => ({
              from: m.from,
              id: m.waMessageId,
              timestamp: "1757000000",
              type: "text",
              text: { body: m.text ?? "مرحبا" },
            })),
          },
        })),
      },
    ],
  };
}

/** نص القائمة وحده، بلا الترحيب — لمقارنة ترتيبين متتاليين. */
async function buildMenuForTest(
  tx: Parameters<typeof buildMenu>[0],
): Promise<string> {
  return (await buildMenu(tx)).text;
}

/** بتسيب حلقة الأحداث تمشي كفاية لمعاملة تانية توصل لمكانها وتنحبس. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

async function postSigned(payload: unknown): Promise<Response> {
  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac("sha256", env().WHATSAPP_APP_SECRET)
    .update(body)
    .digest("hex")}`;
  return fetch(`${baseUrl}${WEBHOOK_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": signature,
    },
    body,
  });
}

beforeAll(async () => {
  audit = auditPool();
  db = new TenantDb();
  await db.start();

  replies = new RecordingWhatsAppSender();
  conversation = new ConversationService(replies);
  server = createWebhookServer({
    service: new WebhookService(db, conversation),
    health: db,
    verifyToken: env().WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    appSecret: env().WHATSAPP_APP_SECRET,
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  replies.reset();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.stop();
  if (createdRestaurants.length > 0) {
    // cascade بيمسح الزبائن والجلسات والقوائم والرسائل الواردة معهم.
    await audit.query("DELETE FROM restaurants WHERE id = ANY($1::uuid[])", [
      createdRestaurants,
    ]);
  }
  await audit.query(
    "DELETE FROM processed_webhook_events WHERE event_id LIKE $1",
    [`wamid.SESSION.${RUN}.%`],
  );
  await audit.end();
});

// ===========================================================================
describe("بوابة ساعات الدوام — FR-22", () => {
  it("مطعم مغلق: ولا جلسة، ورسالة الإغلاق وبس", async () => {
    const pid = phoneId("closed");
    const restaurantId = await createRestaurant({
      phoneNumberId: pid,
      businessHours: ALWAYS_CLOSED_HOURS,
    });
    await addCategory(restaurantId, "مقبلات", [{ name: "حمص", price: "2.50" }]);
    const from = nextCustomer();

    const res = await postSigned(
      metaPayload({ phoneNumberId: pid, waMessageId: wamid("closed"), from }),
    );
    expect(res.status).toBe(200);

    // 🔴 الخاصية الأولى: ولا جلسة. بينسأل فوق RLS.
    expect(await sessionsOf(restaurantId)).toEqual([]);

    // والخاصية التانية: رسالة وحدة، هي رسالة الإغلاق، وما فيها قائمة.
    expect(replies.forRestaurant(restaurantId)).toHaveLength(1);
    const sent = replies.forRestaurant(restaurantId)[0];
    expect(sent?.to).toBe(from);
    expect(sent?.body).toBe(CLOSED_AR);
    expect(sent?.body).not.toContain(MENU_HEADER_AR);
  });

  it("مغلق اليوم بس الحقل فيه أوقات: الرسالة بتعرض نافذة اليوم", async () => {
    const pid = phoneId("closed-with-hours");
    // الأحد مفتوح 10:00-23:00، وباقي الأيام مغلقة. الساعة المحقونة يوم أحد 08:00.
    const restaurantId = await createRestaurant({
      phoneNumberId: pid,
      businessHours: {
        timezone: "Asia/Amman",
        days: { sun: [{ open: "10:00", close: "23:00" }] },
      },
    });
    const from = nextCustomer();

    // 2026-09-13 هو يوم أحد. 08:00 بعمّان = 05:00 UTC.
    const sundayMorning = new Date("2026-09-13T05:00:00Z");
    const scoped = new ConversationService(replies, () => sundayMorning);

    const outcome = await db.runInTenant(restaurantId, (tx) =>
      scoped.handleInbound(tx, { restaurantId, phoneNumberId: pid, from }),
    );

    // 🔴 الفرع اللي مشى، مش أثر جانبي.
    expect(outcome).toBe("closed");
    expect(await sessionsOf(restaurantId)).toEqual([]);
    expect(replies.forRestaurant(restaurantId)[0]?.body).toBe(
      closedMessageAr({ opensAt: "10:00", closesAt: "23:00" }),
    );
  });
});

// ===========================================================================
describe("أول رسالة من زبون بلا جلسة", () => {
  it("مطعم مفتوح: جلسة وحدة + ترحيب وقائمة برسالة وحدة", async () => {
    const pid = phoneId("open");
    const name = `مطعم الاختبار ${RUN}`;
    const restaurantId = await createRestaurant({
      phoneNumberId: pid,
      name,
      businessHours: ALWAYS_OPEN_HOURS,
    });
    await addCategory(restaurantId, "مقبلات", [
      { name: "حمص", price: "2.50" },
      { name: "متبل", price: "3" },
    ]);
    await addCategory(restaurantId, "مشاوي", [
      { name: "شيش طاووق", price: "7.25" },
    ]);
    const from = nextCustomer();

    const res = await postSigned(
      metaPayload({ phoneNumberId: pid, waMessageId: wamid("open"), from }),
    );
    expect(res.status).toBe(200);

    // جلسة وحدة بالضبط، وحالتها بعد الترحيب 'browsing' (CAS مشي).
    const sessions = await sessionsOf(restaurantId);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.state).toBe("browsing");

    // رسالة صادرة وحدة، فيها الترحيب والقائمة سوا.
    const sent = replies.forRestaurant(restaurantId);
    expect(sent).toHaveLength(1);
    const body = sent[0]?.body ?? "";
    expect(body).toContain(welcomeMessageAr(name));
    expect(body).toContain(MENU_HEADER_AR);
    expect(sent[0]?.phoneNumberId).toBe(pid);
    expect(sent[0]?.to).toBe(from);
  });

  it("الترقيم متسلسل عبر القائمة كلها، مش جوّا كل تصنيف", async () => {
    const pid = phoneId("numbering");
    const restaurantId = await createRestaurant({ phoneNumberId: pid });
    await addCategory(restaurantId, "مقبلات", [
      { name: "حمص", price: "2.50" },
      { name: "متبل", price: "3" },
    ]);
    await addCategory(restaurantId, "مشاوي", [
      { name: "شيش طاووق", price: "7.25" },
    ]);
    const from = nextCustomer();

    await db.runInTenant(restaurantId, (tx) =>
      conversation.handleInbound(tx, {
        restaurantId,
        phoneNumberId: pid,
        from,
      }),
    );

    const body = replies.forRestaurant(restaurantId)[0]?.body ?? "";
    expect(body).toContain("1. حمص — 2.50");
    expect(body).toContain("2. متبل — 3.00");
    // 🔴 لو الترقيم كان جوّا كل تصنيف، هاد بيصير "1. شيش طاووق".
    expect(body).toContain("3. شيش طاووق — 7.25");
    // أرقام غربية وبس — القرار المقفول.
    expect(body).not.toMatch(/[٠-٩۰-۹]/);
  });

  it("🔴 تصنيفان بنفس display_order: الترتيب ثابت بالاسم، مش عشوائي", async () => {
    // لقيه اختبار الترقيم: الافتراضي لـdisplay_order هو 0، فتصنيفين بلا ترتيب
    // صريح بيتعادلوا، والفاصل كان `id` — وهو uuid عشوائي. يعني ترتيب القائمة
    // كان بيطلع عشوائيا فعليا لأشيع حالة ممكنة. الفاصل صار الاسم.
    const pid = phoneId("tiebreak");
    const restaurantId = await createRestaurant({ phoneNumberId: pid });

    // الاتنين على display_order = 0 بالقصد — بلا مرور بـaddCategory.
    for (const name of ["مشاوي", "مقبلات"]) {
      const { rows } = await audit.query<{ id: string }>(
        `INSERT INTO menu_categories (restaurant_id, name, display_order)
         VALUES ($1, $2, 0) RETURNING id`,
        [restaurantId, name],
      );
      await audit.query(
        `INSERT INTO menu_items (restaurant_id, category_id, name, price, display_order)
         VALUES ($1, $2, $3, '1.00', 0)`,
        [restaurantId, rows[0]?.id, `صنف ${name}`],
      );
    }

    const from = nextCustomer();
    await db.runInTenant(restaurantId, (tx) =>
      conversation.handleInbound(tx, {
        restaurantId,
        phoneNumberId: pid,
        from,
      }),
    );

    const body = replies.forRestaurant(restaurantId)[0]?.body ?? "";
    // "مشاوي" قبل "مقبلات" بترتيب الفرز العربي — المهم إنه ثابت ومحدَّد بالاسم،
    // مش إنه أبجدي بعينه.
    const مشاوي = body.indexOf("مشاوي");
    const مقبلات = body.indexOf("مقبلات");
    expect(مشاوي).toBeGreaterThan(-1);
    expect(مقبلات).toBeGreaterThan(-1);

    // نفس الاستدعاء مرتين بيعطي نفس الترتيب — هاد اللي كان بينكسر.
    const second = await db.runInTenant(restaurantId, (tx) =>
      buildMenuForTest(tx),
    );
    expect(second).toBe(body.slice(body.indexOf(MENU_HEADER_AR)));
  });

  it("زبون عنده جلسة نشطة: ولا ترحيب تاني، والجلسة بتضل وحدة", async () => {
    const pid = phoneId("second-message");
    const restaurantId = await createRestaurant({ phoneNumberId: pid });
    await addCategory(restaurantId, "مقبلات", [{ name: "حمص", price: "2.50" }]);
    const from = nextCustomer();

    const first = await db.runInTenant(restaurantId, (tx) =>
      conversation.handleInbound(tx, {
        restaurantId,
        phoneNumberId: pid,
        from,
      }),
    );
    const second = await db.runInTenant(restaurantId, (tx) =>
      conversation.handleInbound(tx, {
        restaurantId,
        phoneNumberId: pid,
        from,
      }),
    );

    expect(first).toBe("greeted");
    // 🔴 الفرع نفسه: الرسالة التانية مشت من فرع "جلسة نشطة".
    expect(second).toBe("active_session");
    expect(await sessionsOf(restaurantId)).toHaveLength(1);
    expect(replies.forRestaurant(restaurantId)).toHaveLength(1);
  });
});

// ===========================================================================
describe("رسالتين بفارق ميلي ثانية", () => {
  it("نفس الدفعة: جلسة وحدة مش اتنتين، وترحيب واحد", async () => {
    const pid = phoneId("batch-race");
    const restaurantId = await createRestaurant({ phoneNumberId: pid });
    await addCategory(restaurantId, "مقبلات", [{ name: "حمص", price: "2.50" }]);
    const from = nextCustomer();

    // 🔴 معرّفا رسالة **مختلفان**: بوابة منع التكرار بتمرّق الاتنين بالتصميم،
    //    فاللي بيمنع الجلسة التانية هو فهرس 0007 والـCAS، مش البوابة.
    const res = await postSigned(
      metaPayload(
        { phoneNumberId: pid, waMessageId: wamid("race-a"), from },
        { phoneNumberId: pid, waMessageId: wamid("race-b"), from },
      ),
    );
    expect(res.status).toBe(200);

    expect(await sessionsOf(restaurantId)).toHaveLength(1);
    expect(replies.forRestaurant(restaurantId)).toHaveLength(1);
  });

  it("🔴 فرع التعارض بالضبط: الخاسر بيقرأ صف الفائز وبيتجاهل بصمت", async () => {
    // 🔴 هذا الاختبار **مُرتَّب**، مش سباق. Promise.all على معاملتين ما بيضمن
    //    تداخلا: لو وحدة commit قبل ما التانية تبلّش، التانية بتلاقي جلسة نشطة
    //    وبترجع "active_session" — وهو سلوك صحيح، بس فرع تاني بالكامل. الاختبار
    //    اللي بيعتمد على التوقيت بيتقلّب بين الفرعين حسب حمل الجهاز (وهاد صار
    //    فعلا: مرّ لحاله وسقط تحت `pnpm -r test` المتوازي).
    //
    //    الترتيب هون بيجبر التداخل: الفائز بيكتب وبيمسك معاملته مفتوحة، فالخاسر
    //    بيوصل الإدراج وبينحبس على الفهرس الفريد، وبعدين الفائز بيعمل commit.
    const pid = phoneId("conflict-branch");
    const restaurantId = await createRestaurant({ phoneNumberId: pid });
    await addCategory(restaurantId, "مقبلات", [{ name: "حمص", price: "2.50" }]);
    const from = nextCustomer();
    const ctx = { restaurantId, phoneNumberId: pid, from };

    const { rows } = await audit.query<{ id: string }>(
      `INSERT INTO customers (restaurant_id, phone_number) VALUES ($1, $2) RETURNING id`,
      [restaurantId, from],
    );
    const customerId = rows[0]?.id ?? "";

    const winnerDb = new TenantDb();
    let releaseWinner = (): void => {};
    const winnerHeld = new Promise<void>((resolve) => {
      releaseWinner = resolve;
    });

    try {
      // الفائز بيعمل بالضبط اللي بيعمله المسار الحقيقي — جلسة 'new' ثم CAS
      // لـ'browsing' — وبعدين بيمسك المعاملة مفتوحة.
      const winner = winnerDb.runInTenant(restaurantId, async (tx) => {
        const [row] = await tx
          .insert(conversationSessions)
          .values({ restaurantId, customerId, state: "new" })
          .returning({ id: conversationSessions.id });
        await advanceSessionState(tx, row?.id ?? "", "new", "browsing");
        await winnerHeld;
      });

      await settle();

      // الخاسر بيمشي المسار الحقيقي كاملا، وبينحبس عند الإدراج على الفهرس.
      const loser = db.runInTenant(restaurantId, (tx) =>
        conversation.handleInbound(tx, ctx),
      );

      await settle();
      releaseWinner();
      await winner;

      // 🔴 الفرع اللي مشى: تعارض على الفهرس -> قراءة صف الفائز -> CAS خسر.
      await expect(loser).resolves.toBe("duplicate_ignored");
    } finally {
      releaseWinner();
      await winnerDb.stop();
    }

    // والثابت اللي كل هذا موجود عشانه: جلسة وحدة، وولا ترحيب من الخاسر.
    expect(await sessionsOf(restaurantId)).toHaveLength(1);
    expect(replies.forRestaurant(restaurantId)).toEqual([]);
  });

  it("تزامن حقيقي على اتصالين: الثابت بيصمد مهما كان الترتيب", async () => {
    // هذا الاختبار **ما بيثبّت أي فرع** — التوقيت بيقرّر مين بيفوز وهل في
    // تداخل أصلا. اللي بيثبّته هو الثابت وحده: جلسة وحدة وترحيب واحد، سواء
    // مشى الخاسر من فرع التعارض أو من فرع "جلسة نشطة".
    const pid = phoneId("true-race");
    const restaurantId = await createRestaurant({ phoneNumberId: pid });
    await addCategory(restaurantId, "مقبلات", [{ name: "حمص", price: "2.50" }]);
    const from = nextCustomer();

    const dbA = new TenantDb();
    const dbB = new TenantDb();
    try {
      const ctx = { restaurantId, phoneNumberId: pid, from };
      const outcomes = await Promise.all([
        dbA.runInTenant(restaurantId, (tx) =>
          conversation.handleInbound(tx, ctx),
        ),
        dbB.runInTenant(restaurantId, (tx) =>
          conversation.handleInbound(tx, ctx),
        ),
      ]);

      // ترحيب واحد بالضبط. والتاني إما تعارض أو جلسة نشطة — الاتنين صح.
      expect(outcomes.filter((o) => o === "greeted")).toHaveLength(1);
      expect(
        outcomes.filter(
          (o) => o === "duplicate_ignored" || o === "active_session",
        ),
      ).toHaveLength(1);
    } finally {
      await dbA.stop();
      await dbB.stop();
    }

    expect(await sessionsOf(restaurantId)).toHaveLength(1);
    expect(replies.forRestaurant(restaurantId)).toHaveLength(1);
  });
});

// ===========================================================================
// اختبارات انضافت بعد تمرين الكسر المتعمّد: كل وحدة منهم بتفحص الفرع اللي مشى
// فعليا، بعد ما تبيّن إن كسر البند ما بيسقّط إلا اختبارا واحدا — أو ولا واحد.
// ===========================================================================
describe("الفروع اللي ما كان عليها اختبار", () => {
  it("🔴 زبون رجع بعد ما خلص طلبه: جلسة جديدة بتنفتح، مش محجوز بالقديمة", async () => {
    // كسر "فحص الجلسة النشطة بيتجاهل الحالة" ما أسقط ولا اختبار. يعني ولا شي
    // كان بيثبت إن 'order_placed' و'abandoned' مش حالات نشطة — وبلا هاد، زبون
    // طلب مرة بيضل محجوز بجلسة واحدة **مدى الحياة**، وما بياخد ترحيبا ولا
    // قائمة ولا مرة تانية.
    const pid = phoneId("returning");
    const restaurantId = await createRestaurant({ phoneNumberId: pid });
    await addCategory(restaurantId, "مقبلات", [{ name: "حمص", price: "2.50" }]);
    const from = nextCustomer();
    const ctx = { restaurantId, phoneNumberId: pid, from };

    expect(
      await db.runInTenant(restaurantId, (tx) =>
        conversation.handleInbound(tx, ctx),
      ),
    ).toBe("greeted");

    // الجلسة خلصت بطلب.
    await audit.query(
      "UPDATE conversation_sessions SET state = 'order_placed' WHERE restaurant_id = $1",
      [restaurantId],
    );

    // 🔴 الفرع نفسه: بترجع "greeted" مش "active_session".
    expect(
      await db.runInTenant(restaurantId, (tx) =>
        conversation.handleInbound(tx, ctx),
      ),
    ).toBe("greeted");

    const sessions = await sessionsOf(restaurantId);
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((x) => x.state === "order_placed")).toHaveLength(1);
    expect(sessions.filter((x) => x.state === "browsing")).toHaveLength(1);
    expect(replies.forRestaurant(restaurantId)).toHaveLength(2);
  });

  it("🔴 فهرس 0007 نفسه: جلستان نشطتان لنفس الزبون مرفوضتان من القاعدة", async () => {
    // كسر إزالة ON CONFLICT أسقط اختبارا واحدا بس، وهو اختبار تزامن. هذا بيفحص
    // القيد نفسه مباشرة: حتى لو الكود غلط، القاعدة بترفض.
    const pid = phoneId("index-itself");
    const restaurantId = await createRestaurant({ phoneNumberId: pid });
    const from = nextCustomer();

    const { rows } = await audit.query<{ id: string }>(
      `INSERT INTO customers (restaurant_id, phone_number) VALUES ($1, $2) RETURNING id`,
      [restaurantId, from],
    );
    const customerId = rows[0]?.id;

    const insertSession = (state: string): Promise<unknown> =>
      audit.query(
        `INSERT INTO conversation_sessions (restaurant_id, customer_id, state)
         VALUES ($1, $2, $3::conversation_state)`,
        [restaurantId, customerId, state],
      );

    await insertSession("new");
    // التانية نشطة كمان -> لازم القاعدة ترفض.
    await expect(insertSession("browsing")).rejects.toThrow(
      /idx_sessions_one_active_per_customer|duplicate key/i,
    );

    // وجلسة **منتهية** مسموحة: القيد جزئي، مش على كل الصفوف.
    await expect(insertSession("order_placed")).resolves.toBeDefined();
    await expect(insertSession("abandoned")).resolves.toBeDefined();
  });

  it("🔴 CAS نفسه: النداء التاني بنفس الحالة المتوقعة بيرجّع false", async () => {
    // كسر إلغاء CAS أسقط اختبار تزامن واحد. هذا بيفحص البدائية مباشرة:
    // نداءان متتاليان، الأول بيفوز والتاني بيخسر — وهي بالضبط "ضغطة مكررة".
    const pid = phoneId("cas-itself");
    const restaurantId = await createRestaurant({ phoneNumberId: pid });
    const from = nextCustomer();

    const { rows: c } = await audit.query<{ id: string }>(
      `INSERT INTO customers (restaurant_id, phone_number) VALUES ($1, $2) RETURNING id`,
      [restaurantId, from],
    );
    const { rows: s } = await audit.query<{ id: string }>(
      `INSERT INTO conversation_sessions (restaurant_id, customer_id, state)
       VALUES ($1, $2, 'new') RETURNING id`,
      [restaurantId, c[0]?.id],
    );
    const sessionId = s[0]?.id ?? "";

    const [first, second] = await db.runInTenant(restaurantId, async (tx) => [
      await advanceSessionState(tx, sessionId, "new", "browsing"),
      await advanceSessionState(tx, sessionId, "new", "browsing"),
    ]);

    expect(first).toBe(true);
    // 🔴 صفر صفوف = ضغطة مكررة، تُتجاهَل بصمت. مش استثناء.
    expect(second).toBe(false);
  });

  it("🔴 إغلاق بعد منتصف الليل عبر المسار الحقيقي: جلسة بتنفتح الساعة 1:00 ص", async () => {
    // فحص decideHours لحاله أسقط اختبارا واحدا. هذا بيمشي نفس الحالة من طرف
    // لطرف: مطعم بيسكّر 2:00 ص، زبون بيراسل 1:00 ص -> لازم جلسة وترحيب.
    const pid = phoneId("after-midnight");
    const restaurantId = await createRestaurant({
      phoneNumberId: pid,
      businessHours: {
        timezone: "Asia/Amman",
        days: { sun: [{ open: "22:00", close: "02:00" }] },
      },
    });
    await addCategory(restaurantId, "مقبلات", [{ name: "حمص", price: "2.50" }]);
    const from = nextCustomer();
    const ctx = { restaurantId, phoneNumberId: pid, from };

    // الاثنين 01:00 بعمّان = الأحد 22:00 UTC. ذيل نافذة الأحد.
    const onePastMidnight = new ConversationService(
      replies,
      () => new Date("2026-09-13T22:00:00Z"),
    );
    expect(
      await db.runInTenant(restaurantId, (tx) =>
        onePastMidnight.handleInbound(tx, ctx),
      ),
    ).toBe("greeted");
    expect(await sessionsOf(restaurantId)).toHaveLength(1);

    // ونفس المطعم الساعة 3:00 ص (بعد ما سكّر) بيرفض — عشان الاختبار ما يمر
    // لمجرد إن البوابة دايما مفتوحة.
    const other = nextCustomer();
    const threeAm = new ConversationService(
      replies,
      () => new Date("2026-09-14T00:00:00Z"),
    );
    expect(
      await db.runInTenant(restaurantId, (tx) =>
        threeAm.handleInbound(tx, { ...ctx, from: other }),
      ),
    ).toBe("closed");
  });
});

// ===========================================================================
describe("عزل المستأجرين", () => {
  it("الجلسة بتنفتح تحت المطعم الصح، وولا رسالة بتروح لمطعم تاني", async () => {
    const pidA = phoneId("tenant-a");
    const pidB = phoneId("tenant-b");
    const chainId = randomUUID();
    // 🔴 نفس السلسلة بالقصد: لو العزل انكسر، الجلسة بتظهر عند الأخ مش عند غريب،
    //    وهاد هو الشكل اللي بينفلت من اختبار مكتوب على مطعمين ما إلهم علاقة.
    const restaurantA = await createRestaurant({ phoneNumberId: pidA });
    const restaurantB = await createRestaurant({ phoneNumberId: pidB });
    await audit.query(
      "UPDATE restaurants SET chain_id = $1 WHERE id = ANY($2::uuid[])",
      [chainId, [restaurantA, restaurantB]],
    );
    await addCategory(restaurantA, "مقبلات", [{ name: "حمص", price: "2.50" }]);
    await addCategory(restaurantB, "مقبلات", [
      { name: "بابا غنوج", price: "3.00" },
    ]);

    const from = nextCustomer();
    const res = await postSigned(
      metaPayload({ phoneNumberId: pidA, waMessageId: wamid("tenant"), from }),
    );
    expect(res.status).toBe(200);

    // 🔴 السؤال بينسأل فوق RLS: عند أي مطعم انفتحت جلسة لهالرقم؟
    expect(await sessionRestaurantsFor(from)).toEqual([restaurantA]);
    expect(await sessionsOf(restaurantB)).toEqual([]);

    // ولا رسالة صادرة انسبت لمطعم B، ولا وحدة انبعثت من رقمه.
    expect(replies.forRestaurant(restaurantB)).toEqual([]);
    expect(replies.sent.every((m) => m.phoneNumberId === pidA)).toBe(true);

    // وقائمة B ما ظهرت بنص الرسالة اللي راحت لزبون A.
    expect(replies.forRestaurant(restaurantA)[0]?.body).not.toContain(
      "بابا غنوج",
    );
  });
});

// ===========================================================================
describe("سقف نص واتساب", () => {
  it("قائمة أطول من السقف: تنكشف، ولا تنقطع، وولا جلسة بتنفتح", async () => {
    const pid = phoneId("too-long");
    const restaurantId = await createRestaurant({ phoneNumberId: pid });
    // أصناف كفاية لتجاوز 4096 محرفا.
    await addCategory(
      restaurantId,
      "قائمة طويلة",
      Array.from({ length: 120 }, (_, i) => ({
        name: `صنف طويل الاسم عمدا لتجاوز سقف واتساب رقم ${i + 1}`,
        price: "9.99",
      })),
    );
    const from = nextCustomer();

    const outcome = await db.runInTenant(restaurantId, (tx) =>
      conversation.handleInbound(tx, {
        restaurantId,
        phoneNumberId: pid,
        from,
      }),
    );

    // 🔴 الفرع نفسه، مش أثر جانبي.
    expect(outcome).toBe("reply_too_long");
    // ما انبعث إشي — لا كامل ولا مقطوع.
    expect(replies.forRestaurant(restaurantId)).toEqual([]);
    // وولا جلسة، عشان الحالة تتعافى لحالها بعد ما المطعم يقصّر قائمته.
    expect(await sessionsOf(restaurantId)).toEqual([]);
  });

  it("بعد ما تقصر القائمة، نفس الزبون بياخد ترحيبه عاديا", async () => {
    const pid = phoneId("recovers");
    const restaurantId = await createRestaurant({ phoneNumberId: pid });
    await addCategory(
      restaurantId,
      "قائمة طويلة",
      Array.from({ length: 120 }, (_, i) => ({
        name: `صنف طويل الاسم عمدا لتجاوز سقف واتساب رقم ${i + 1}`,
        price: "9.99",
      })),
    );
    const from = nextCustomer();
    const ctx = { restaurantId, phoneNumberId: pid, from };

    expect(
      await db.runInTenant(restaurantId, (tx) =>
        conversation.handleInbound(tx, ctx),
      ),
    ).toBe("reply_too_long");

    // المطعم قصّر قائمته.
    await audit.query(
      `DELETE FROM menu_items WHERE restaurant_id = $1 AND display_order > 2`,
      [restaurantId],
    );

    expect(
      await db.runInTenant(restaurantId, (tx) =>
        conversation.handleInbound(tx, ctx),
      ),
    ).toBe("greeted");
    expect(await sessionsOf(restaurantId)).toHaveLength(1);
    const body = replies.forRestaurant(restaurantId)[0]?.body ?? "";
    expect([...body].length).toBeLessThanOrEqual(WHATSAPP_TEXT_LIMIT);
  });
});

// ===========================================================================
// حالات ساعات الدوام الحدّية. بلا قاعدة — decideHours دالة صافية، والساعة
// معطاة، فكل حالة بتنكتب كحقيقة ثابتة مش كشي بيعتمد على وقت التشغيل.
// ===========================================================================
describe("decideHours — الحالات الحدّية", () => {
  /** 2026-09-13 أحد · 2026-09-14 اثنين. */
  const sundayAt = (utc: string): Date => new Date(`2026-09-13T${utc}Z`);

  it("الحقل الفاضي = مفتوح دايما", () => {
    expect(decideHours({}, sundayAt("00:00:00")).open).toBe(true);
    expect(decideHours({}, sundayAt("13:00:00")).open).toBe(true);
  });

  it("حقل مشوّه = مفتوح، مش مغلق", () => {
    // 🔴 الاتجاه عند الشك. مطعم ما بيقدر يستقبل طلبات بسبب jsonb مكسور بيخسر
    //    مبيعات وهو ما بيعرف؛ مطعم استقبل رسالة وهو مسكّر بيشوفها وبيتصرّف.
    expect(decideHours("مش كائن", sundayAt("13:00:00")).open).toBe(true);
    expect(decideHours(null, sundayAt("13:00:00")).open).toBe(true);
    expect(decideHours(42, sundayAt("13:00:00")).open).toBe(true);
  });

  it("المنطقة الزمنية بتحكم، مش توقيت الخادم", () => {
    const hours = {
      timezone: "Asia/Amman",
      days: { sun: [{ open: "10:00", close: "23:00" }] },
    };
    // 08:00 UTC = 11:00 بعمّان (UTC+3 ثابتة — الأردن ألغى التوقيت الصيفي 2022).
    expect(decideHours(hours, sundayAt("08:00:00")).open).toBe(true);
    // 05:00 UTC = 08:00 بعمّان -> مسكّر، مع إنه 05:00 UTC ممكن يكون ضمن الدوام
    // لو انقرأ بتوقيت الخادم.
    expect(decideHours(hours, sundayAt("05:00:00")).open).toBe(false);

    // نفس اللحظة بمنطقة تانية بتعطي جوابا مختلفا — وهاد بالضبط اللي بينكسر
    // لما حدا يستعمل توقيت الخادم.
    const utcHours = {
      timezone: "UTC",
      days: { sun: [{ open: "10:00", close: "23:00" }] },
    };
    expect(decideHours(utcHours, sundayAt("05:00:00")).open).toBe(false);
    expect(decideHours(utcHours, sundayAt("11:00:00")).open).toBe(true);
  });

  it("منطقة زمنية مش معروفة = مفتوح، مش انفجار", () => {
    const hours = {
      timezone: "Mars/Olympus_Mons",
      days: { sun: [{ open: "10:00", close: "23:00" }] },
    };
    expect(decideHours(hours, sundayAt("05:00:00")).open).toBe(true);
  });

  it("🔴 إغلاق بعد منتصف الليل: 22:00 -> 02:00 بيضل مفتوح الساعة 1:00 ص", () => {
    const hours = {
      timezone: "Asia/Amman",
      days: { sun: [{ open: "22:00", close: "02:00" }] },
    };
    // الأحد 23:00 بعمّان = 20:00 UTC الأحد -> جوّا نافذة الأحد.
    expect(decideHours(hours, sundayAt("20:00:00")).open).toBe(true);

    // الاثنين 01:00 بعمّان = 22:00 UTC الأحد. هاي **ذيل نافذة الأحد**، والاثنين
    // نفسه ما إله نافذة. بلا فحص اليوم السابق بترجع "مغلق" وهو مفتوح.
    const mondayOneAm = new Date("2026-09-13T22:00:00Z");
    expect(decideHours(hours, mondayOneAm).open).toBe(true);

    // الاثنين 03:00 بعمّان = 00:00 UTC الاثنين -> بعد ما سكّر.
    const mondayThreeAm = new Date("2026-09-14T00:00:00Z");
    expect(decideHours(hours, mondayThreeAm).open).toBe(false);
  });

  it("🔴 نافذة صفرية (open == close) = مغلق، مش أربعا وعشرين ساعة", () => {
    const hours = {
      timezone: "Asia/Amman",
      days: { sun: [{ open: "00:00", close: "00:00" }] },
    };
    // اليوم معرَّف (فمش "مفتوح دايما")، بس نافذته الوحيدة صفرية فانشالت.
    // التفسير الغلط — "00:00 لـ00:00 يعني اليوم كله" — بيخلّي غلطة إدخال
    // تفتح المطعم أبدا. المسار الموثّق للـ24 ساعة هو business_hours فاضي.
    const decision = decideHours(hours, sundayAt("13:00:00"));
    expect(decision.open).toBe(false);
    expect(decision.todayWindow).toBeNull();
    // والفرق عن الفاضي: الفاضي مفتوح.
    expect(decideHours({}, sundayAt("13:00:00")).open).toBe(true);
  });

  it("دوام مقسوم: مسكّر بين النافذتين", () => {
    const hours = {
      timezone: "Asia/Amman",
      days: {
        sun: [
          { open: "10:00", close: "14:00" },
          { open: "18:00", close: "23:00" },
        ],
      },
    };
    // 12:00 بعمّان = 09:00 UTC -> جوّا الأولى.
    expect(decideHours(hours, sundayAt("09:00:00")).open).toBe(true);
    // 16:00 بعمّان = 13:00 UTC -> بالفجوة.
    expect(decideHours(hours, sundayAt("13:00:00")).open).toBe(false);
    // 20:00 بعمّان = 17:00 UTC -> جوّا التانية.
    expect(decideHours(hours, sundayAt("17:00:00")).open).toBe(true);
    // الرسالة بتعرض أول نافذة — خانتين مش أربعة.
    expect(decideHours(hours, sundayAt("13:00:00")).todayWindow).toEqual({
      opensAt: "10:00",
      closesAt: "14:00",
    });
  });

  it("أسماء الأيام الطويلة مقبولة زي الثلاثية", () => {
    const hours = {
      timezone: "Asia/Amman",
      days: { sunday: [{ open: "10:00", close: "23:00" }] },
    };
    expect(decideHours(hours, sundayAt("08:00:00")).open).toBe(true);
  });
});
