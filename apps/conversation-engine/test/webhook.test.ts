/**
 * مستقبِل webhook واتساب — اختبارات على قاعدة حقيقية.
 *
 * ولا mock هون بالقصد. الأربع خصائص اللي هالسويت موجودة عشانها كلها بتعيش
 * عند حدود ما بين التطبيق وPostgres، وأي بديل مزيّف بيثبت إن الكود بينادي
 * الدوال اللي كتبناها — مش إن العزل شغّال:
 *
 *   1. التوقيع محسوب على البايتات الخام، مش على JSON معاد التسلسل.
 *   2. منع التكرار ذرّي: نفس message_id مرتين = صف واحد، مش اتنين.
 *   3. الرسالة بتنكتب تحت سياق المطعم اللي طلع من phone_number_id — وبتنقرأ
 *      من هداك السياق وبس.
 *   4. رقم مش معروف = ولا صف بأي مكان بالجدول، مش صف عند مطعم غلط — وولا
 *      مطالبة منع تكرار كمان، عشان إعادة الإرسال بعد تصليح الربط تنجح.
 *
 * البيانات من db/seed/chain-isolation-fixture.sql، فلازم `pnpm db:migrate`
 * و`pnpm db:seed` يكونوا اشتغلوا. الشكل اللي بيهمّ: مطعم A على PHONE_A،
 * ومطعم B على PHONE_B، والاتنين نفس السلسلة — يعني لو العزل انكسر، الرسالة
 * بتظهر عند الأخ مش عند غريب.
 */
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { createHmac, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, sql } from "drizzle-orm";
import { Pool } from "pg";

import { env } from "../src/config/env.js";
import { inboundMessages } from "../src/db/schema.js";
import { TenantDb } from "../src/db/tenant-db.js";
import { createWebhookServer } from "../src/http/server.js";
import { parseWebhookPayload } from "../src/whatsapp/payload.js";
import {
  needsRedelivery,
  WebhookService,
} from "../src/whatsapp/webhook.service.js";

const RESTAURANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RESTAURANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PHONE_ID_A = "PHONE_A";
const PHONE_ID_B = "PHONE_B";
/** مش موجود بأي صف restaurants — ولا لازم يصير. */
const PHONE_ID_UNKNOWN = "PHONE_ID_THAT_IS_NOT_OURS";

const CUSTOMER_PHONE = "962790000001";

/** معرّفات فريدة لكل تشغيلة: السويت بتنعاد بلا تصفير القاعدة. */
const RUN = randomUUID();
const wamid = (label: string): string => `wamid.TEST.${RUN}.${label}`;

let db: TenantDb;
let service: WebhookService;
let server: Server;
let baseUrl: string;
let audit: Pool;

/** مطاعم أنشأها الاختبار. بتنمسح بـafterAll، والرسائل بتنمسح معها cascade. */
const createdRestaurants: string[] = [];

/**
 * مطعم مؤقت على رقم خاص بهالتشغيلة.
 *
 * لازم يكون صف حقيقي مش fixture ثابت: الاختبار المحوري بيحتاج يبدّل حالة
 * الربط بنص الاختبار — من "ما في مطعم" لـ"في مطعم" — وتعديل صفوف الـfixture
 * المشتركة بيكسر باقي السويتات.
 */
async function createRestaurant(
  phoneId: string,
  status: "active" | "suspended",
): Promise<string> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status)
     VALUES ($1, $2, $3::restaurant_status) RETURNING id`,
    [`مطعم اختبار ${RUN}`, phoneId, status],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("ما انكتب صف مطعم للاختبار");
  createdRestaurants.push(id);
  return id;
}

/**
 * اتصال تدقيق بصلاحيات المُهاجِر — للاختبارات وبس.
 *
 * 🔴 ليش superuser هون بالذات، والقاعدة كلها بتقول لا: عشان السؤال "هل
 *    انكتب صف عند أي مطعم تاني؟" ما بينسأل من جوّا RLS. دور sufria_engine
 *    بيشوف سياقه هو بس، فـ"ما شفت صف" منه بتحتمل تفسيرين — ما انكتب، أو
 *    انكتب عند غيري وأنا ممنوع أشوفه. والتفسير التاني هو بالضبط العطل اللي
 *    عم نختبره.
 *
 *    الاتصال هذا ما بيمرّ من كود التطبيق إطلاقا: بس يقرأ ويكنس بعد الاختبار.
 */
function auditPool(): Pool {
  const url = process.env["MIGRATION_DATABASE_URL"];
  if (!url) {
    throw new Error(
      "MIGRATION_DATABASE_URL مفقود — الاختبار بيحتاجه ليتأكد إنه ما انكتب " +
        "صف عند مطعم تاني. انسخ .env.example لـ.env.",
    );
  }
  return new Pool({ connectionString: url, max: 1 });
}

// --- بناء حمولات ميتا -------------------------------------------------------

interface MessageOpts {
  phoneNumberId: string;
  waMessageId: string;
  from?: string;
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
        changes: [...byPhoneId.entries()].map(([phoneNumberId, bucket]) => ({
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "962790000000",
              phone_number_id: phoneNumberId,
            },
            contacts: [
              { profile: { name: "زبون اختبار" }, wa_id: CUSTOMER_PHONE },
            ],
            messages: bucket.map((m) => ({
              from: m.from ?? CUSTOMER_PHONE,
              id: m.waMessageId,
              timestamp: "1757000000",
              type: "text",
              text: { body: m.text ?? "مرحبا، بدي أطلب" },
            })),
          },
        })),
      },
    ],
  };
}

function sign(body: string): string {
  return `sha256=${createHmac("sha256", env().WHATSAPP_APP_SECRET)
    .update(body)
    .digest("hex")}`;
}

/** بتبعت البايتات المعطاة حرفيا — بلا إعادة تسلسل. هاد جوهر اختبار التوقيع. */
function postRaw(
  body: string,
  signature: string | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (signature !== undefined) headers["x-hub-signature-256"] = signature;
  return fetch(`${baseUrl}/webhook`, { method: "POST", headers, body });
}

/** الطريق السعيد: تسلسل، توقيع على نفس النص، إرسال. */
function postSigned(payload: unknown): Promise<Response> {
  const body = JSON.stringify(payload);
  return postRaw(body, sign(body));
}

// --- قراءات التحقق ----------------------------------------------------------

/** بيشوف الجدول كله فوق RLS — للتأكد من الغياب، مش للتأكد من الوجود. */
async function countEverywhere(waMessageId: string): Promise<number> {
  const { rows } = await audit.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM inbound_messages WHERE wa_message_id = $1",
    [waMessageId],
  );
  return Number(rows[0]?.n ?? "0");
}

async function countClaims(waMessageId: string): Promise<number> {
  const { rows } = await audit.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM processed_webhook_events WHERE event_id = $1 AND source = 'whatsapp'",
    [waMessageId],
  );
  return Number(rows[0]?.n ?? "0");
}

/**
 * سيرفر على مخزن معيّن، مع عنوانه ودالة إغلاقه.
 *
 * بتستعمله الاختبارات اللي بدها قاعدة **ساقطة فعلا** — مخزن مسكّر، منفذ ما
 * حدا سامع عليه، اسم قاعدة مش موجود. ولا وحدة منهم mock: الفشل بيجي من
 * الشبكة أو من Postgres نفسه.
 */
async function serverOn(
  target: TenantDb,
): Promise<{ url: string; close: () => Promise<void> }> {
  const instance = createWebhookServer({
    service: new WebhookService(target),
    health: target,
    verifyToken: env().WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    appSecret: env().WHATSAPP_APP_SECRET,
  });
  await new Promise<void>((resolve) => {
    instance.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${(instance.address() as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        instance.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/**
 * نفس رابط المحرّك بس على اسم قاعدة مش موجود.
 *
 * الفشل هون مختلف نوعيا عن المخزن المسكّر: الاتصال بينفتح على TCP وPostgres
 * نفسه بيرفضه. فمعالج بيميّز "المخزن مسكّر" وبس بينمسك هون.
 */
function missingDatabaseUrl(): string {
  const url = new URL(env().ENGINE_DATABASE_URL);
  url.pathname = `/sufria_does_not_exist_${RUN.slice(0, 8)}`;
  return url.toString();
}

/** بيقرأ من جوّا سياق المطعم — يعني تحت RLS، زي أي كود تطبيق. */
function readAsTenant(
  restaurantId: string,
  waMessageId: string,
): Promise<{ id: string; body: string | null; messageType: string }[]> {
  return db.runInTenant(restaurantId, (tx) =>
    tx
      .select({
        id: inboundMessages.id,
        body: inboundMessages.body,
        messageType: inboundMessages.messageType,
      })
      .from(inboundMessages)
      .where(
        and(
          eq(inboundMessages.restaurantId, restaurantId),
          eq(inboundMessages.waMessageId, waMessageId),
        ),
      ),
  );
}

beforeAll(async () => {
  audit = auditPool();

  db = new TenantDb();
  // نفس فحص الإقلاع الحقيقي: لو ENGINE_DATABASE_URL كان postgres، RLS متجاوَز
  // وكل تأكيد عزل بهالملف بيمر بلا ما يفحص إشي. الرمية هون بتوقف السويت.
  await db.start();

  service = new WebhookService(db);
  server = createWebhookServer({
    service,
    health: db,
    verifyToken: env().WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    appSecret: env().WHATSAPP_APP_SECRET,
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await db.stop();

  // كنس صفوف هالتشغيلة وبس — القاعدة مشتركة مع باقي السويتات.
  await audit.query(
    "DELETE FROM inbound_messages WHERE wa_message_id LIKE $1",
    [`wamid.TEST.${RUN}.%`],
  );
  await audit.query(
    "DELETE FROM processed_webhook_events WHERE event_id LIKE $1",
    [`wamid.TEST.${RUN}.%`],
  );
  // المطاعم المؤقتة آخر إشي — رسائلها بتروح معها بـON DELETE CASCADE.
  if (createdRestaurants.length > 0) {
    await audit.query("DELETE FROM restaurants WHERE id = ANY($1::uuid[])", [
      createdRestaurants,
    ]);
  }
  await audit.end();
});

describe("GET /webhook — تحقّق الاشتراك", () => {
  const verifyUrl = (params: Record<string, string>): string =>
    `${baseUrl}/webhook?${new URLSearchParams(params).toString()}`;

  it("يرجّع hub.challenge كنص خام لما التوكن يطابق", async () => {
    const res = await fetch(
      verifyUrl({
        "hub.mode": "subscribe",
        "hub.verify_token": env().WHATSAPP_WEBHOOK_VERIFY_TOKEN,
        "hub.challenge": "1158201444",
      }),
    );

    expect(res.status).toBe(200);
    // 🔴 نص خام. ميتا بتقارن الجسم حرفيا، و"1158201444" بعلامات تنصيص
    //    (يعني JSON) بتفشّل ربط الـwebhook برسالة ما بتقول السبب.
    expect(await res.text()).toBe("1158201444");
  });

  it("يرفض توكن غلط بـ403 وما يرجّع الـchallenge", async () => {
    const res = await fetch(
      verifyUrl({
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong-token",
        "hub.challenge": "1158201444",
      }),
    );

    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("1158201444");
  });

  it("يرفض طلب بلا توكن", async () => {
    const res = await fetch(
      verifyUrl({ "hub.mode": "subscribe", "hub.challenge": "1158201444" }),
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /webhook — التوقيع", () => {
  it("توقيع صحيح: 200 والرسالة انخزنت عند مطعم الـphone_number_id", async () => {
    const id = wamid("valid-signature");
    const res = await postSigned(
      metaPayload({
        phoneNumberId: PHONE_ID_A,
        waMessageId: id,
        text: "بدي شاورما دجاج",
      }),
    );

    expect(res.status).toBe(200);

    const rows = await readAsTenant(RESTAURANT_A, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe("بدي شاورما دجاج");
    expect(rows[0]?.messageType).toBe("text");
  });

  it("توقيع فاشل: 401 وولا صف انكتب وولا حدث انطالب", async () => {
    const id = wamid("bad-signature");
    const body = JSON.stringify(
      metaPayload({ phoneNumberId: PHONE_ID_A, waMessageId: id }),
    );

    const res = await postRaw(body, `sha256=${"0".repeat(64)}`);

    expect(res.status).toBe(401);
    // الطلب انرمى قبل أي منطق: لا صف رسالة، ولا حتى مطالبة بجدول منع التكرار.
    expect(await countEverywhere(id)).toBe(0);
    expect(await countClaims(id)).toBe(0);
  });

  it("توقيع مفقود بالكامل: 401", async () => {
    const id = wamid("no-signature");
    const body = JSON.stringify(
      metaPayload({ phoneNumberId: PHONE_ID_A, waMessageId: id }),
    );

    const res = await postRaw(body, undefined);

    expect(res.status).toBe(401);
    expect(await countEverywhere(id)).toBe(0);
  });

  it("محسوب على البايتات الخام: نفس الكائن بمسافات مختلفة توقيعه بيفشل", async () => {
    // 🔴 هذا الاختبار هو المصيدة اللي بتضيّع يوم كامل (docs/06 §405).
    //    الكائنان متطابقان بعد JSON.parse؛ البايتات مختلفة. لو التنفيذ حسب
    //    التوقيع على شكل معاد تسلسله بدل الجسم الخام، الحالتان تحت بتنعكس:
    //    المضغوط بينجح والمنسّق بيفشل — وهاد بالضبط اللي بيخلي كل رسالة
    //    حقيقية من ميتا ترجع 401 بالإنتاج.
    const id = wamid("raw-bytes");
    const payload = metaPayload({
      phoneNumberId: PHONE_ID_A,
      waMessageId: id,
      text: "نص عربي بيتغيّر ترميزه لو انعاد تسلسله",
    });

    const compact = JSON.stringify(payload);
    const pretty = JSON.stringify(payload, null, 2);
    expect(pretty).not.toBe(compact);

    // توقيع المضغوط + جسم منسّق = بايتات مش هي اللي انوقّعت.
    const mismatched = await postRaw(pretty, sign(compact));
    expect(mismatched.status).toBe(401);
    expect(await countEverywhere(id)).toBe(0);

    // نفس الجسم المنسّق، بس موقّع على بايتاته هو. لازم يمر.
    const matched = await postRaw(pretty, sign(pretty));
    expect(matched.status).toBe(200);
    expect(await countEverywhere(id)).toBe(1);
  });
});

describe("POST /webhook — منع التكرار", () => {
  it("نفس message_id مرتين: 200 مرتين، وصف واحد بس", async () => {
    const id = wamid("duplicate");
    const payload = metaPayload({
      phoneNumberId: PHONE_ID_A,
      waMessageId: id,
      text: "رسالة وحدة، تسليمين",
    });

    const first = await postSigned(payload);
    const second = await postSigned(payload);

    // 🔴 المكرر تجاهل صامت + 200. أي رد تاني بيخلي ميتا تعيد الإرسال
    //    وبينزّل تقييم جودة الرقم (NFR-05).
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    expect(await countEverywhere(id)).toBe(1);
    // والمطالبة وحدة كمان — UNIQUE(event_id, source) هي اللي بتحسم.
    expect(await countClaims(id)).toBe(1);
  });

  it("التسليم التاني بيتصنّف مكرر — مش بيرتطم بقيد UNIQUE", async () => {
    // 🔴 ليش هالاختبار موجود إضافة للي فوقه: عدّ الصفوف لحاله ما بيميّز
    //    "البوابة قالت مكرر فوقفت" عن "البوابة مشت والـINSERT وقع على
    //    UNIQUE(restaurant_id, wa_message_id) وانمسك بالـcatch". الاتنين
    //    بينتهوا بصف واحد ورد 200.
    //
    //    الفرق مهم: القيد آخر خط دفاع، والبوابة أول واحد. لو البوابة انكسرت
    //    وضلّينا نعتمد عالقيد، أول جدول ما إله قيد مكافئ — رسالة صادرة،
    //    صف طلب — بيتضاعف بصمت. فالتأكيد هون على الفرع اللي مشى فعليا،
    //    وهو بيمرّ من نفس القاعدة الحقيقية زي غيره.
    const id = wamid("duplicate-branch");
    const parsed = parseWebhookPayload(
      metaPayload({ phoneNumberId: PHONE_ID_A, waMessageId: id }),
    );
    if (parsed === null) throw new Error("الحمولة المبنية بالاختبار ما انقرأت");

    expect(await service.ingest(parsed)).toEqual(["stored"]);
    expect(await service.ingest(parsed)).toEqual(["duplicate"]);
    expect(await countEverywhere(id)).toBe(1);
  });

  it("نفس المعرّف من مصدر تاني بينعالج مستقل", async () => {
    // المفتاح UNIQUE(event_id, source). صف payment_gateway بنفس المعرّف
    // ما بيمنع مطالبة whatsapp — ولو منع، أول تصادم معرّفات بين مزوّدين
    // بيبلّع رسالة زبون بصمت.
    const id = wamid("cross-source");
    await audit.query(
      "INSERT INTO processed_webhook_events (event_id, source) VALUES ($1, 'payment_gateway')",
      [id],
    );

    const res = await postSigned(
      metaPayload({ phoneNumberId: PHONE_ID_A, waMessageId: id }),
    );

    expect(res.status).toBe(200);
    expect(await countEverywhere(id)).toBe(1);
    expect(await countClaims(id)).toBe(1);
  });
});

describe("POST /webhook — التوجيه والعزل", () => {
  it("رقم غير معروف: 500، وولا صف بأي مكان بالجدول", async () => {
    const id = wamid("unknown-phone");

    const res = await postSigned(
      metaPayload({ phoneNumberId: PHONE_ID_UNKNOWN, waMessageId: id }),
    );

    // 🔴 500 مش 200. رقم مش معروف حالة قابلة للتصليح — الربط عند ميتا
    //    بينتظبط، أو الرقم بينضاف للمطعم — و200 بتقول "خلصت" وبترمي الرسالة.
    expect(res.status).toBe(500);

    // 🔴 التأكيد اللي بيهم: ولا صف — لا عند A ولا B ولا أي مطعم تالت.
    //    هالسؤال بينسأل فوق RLS بالقصد: من جوّا سياق مطعم، "ما شفت صف"
    //    ممكن تعني "انكتب عند غيري"، وهاد نفسه العطل.
    expect(await countEverywhere(id)).toBe(0);
    expect(await readAsTenant(RESTAURANT_A, id)).toHaveLength(0);
    expect(await readAsTenant(RESTAURANT_B, id)).toHaveLength(0);
  });

  it("رسالة لـPHONE_B ما بتظهر بسياق مطعم A", async () => {
    const id = wamid("isolation");

    const res = await postSigned(
      metaPayload({ phoneNumberId: PHONE_ID_B, waMessageId: id }),
    );
    expect(res.status).toBe(200);

    // A و B فرعان بنفس السلسلة (chain_id واحد بالـfixture). لو التسريب صار،
    // بيصير هون — والسلسلة علاقة بيانات، مش تصريح وصول.
    expect(await readAsTenant(RESTAURANT_B, id)).toHaveLength(1);
    expect(await readAsTenant(RESTAURANT_A, id)).toHaveLength(0);
  });

  it("رسالتان بنفس الطلب لمطعمين مختلفين بتنسندوا كل وحدة لمطعمها", async () => {
    const idA = wamid("batch-a");
    const idB = wamid("batch-b");

    const res = await postSigned(
      metaPayload(
        { phoneNumberId: PHONE_ID_A, waMessageId: idA, text: "للفرع أ" },
        { phoneNumberId: PHONE_ID_B, waMessageId: idB, text: "للفرع ب" },
      ),
    );
    expect(res.status).toBe(200);

    expect(await readAsTenant(RESTAURANT_A, idA)).toHaveLength(1);
    expect(await readAsTenant(RESTAURANT_B, idB)).toHaveLength(1);
    // والتقاطع فاضي بالاتجاهين.
    expect(await readAsTenant(RESTAURANT_B, idA)).toHaveLength(0);
    expect(await readAsTenant(RESTAURANT_A, idB)).toHaveLength(0);
  });

  it("ما بيخلّي السياق على الاتصال المجمّع", async () => {
    const id = wamid("no-leak");
    await postSigned(
      metaPayload({ phoneNumberId: PHONE_ID_A, waMessageId: id }),
    );

    // PG_POOL_MAX=1، فهاي نفس الاتصال اللي كتب الرسالة فوق. لو السياق
    // انضبط بـSET عادي بدل set_config(..., is_local => true)، بيطلع هون
    // معرّف مطعم A — والطلب اللي بعده بيرث مستأجر غيره.
    const leaked = await db.runUnscoped(async (tx) => {
      const res = await tx.execute<{ ctx: string | null }>(
        sql`SELECT current_setting('app.current_restaurant_id', true) AS ctx`,
      );
      return res.rows[0]?.ctx ?? null;
    });

    // Postgres بيرجّع الإعداد المحلي لـ'' مش بيشيله.
    expect(leaked ?? "").toBe("");
  });
});

describe("POST /webhook — حمولات ما بنتعامل معها", () => {
  it("JSON مشوّه: 200 وبلا استثناء", async () => {
    const res = await postRaw("{ not json at all", sign("{ not json at all"));
    expect(res.status).toBe(200);
  });

  it("نوع رسالة ما بندعمه (صورة): 200 وبينخزن بلا نص", async () => {
    // 🔴 زبون بعت صورة ≠ خطأ بالنظام. لازم 200، وإلا ميتا بتعيد الإرسال
    //    وبتخفّض تقييم الرقم.
    const id = wamid("image");
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_TEST",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: PHONE_ID_A },
                messages: [
                  {
                    from: CUSTOMER_PHONE,
                    id,
                    timestamp: "1757000000",
                    type: "image",
                    image: { id: "media-123", mime_type: "image/jpeg" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const res = await postRaw(body, sign(body));
    expect(res.status).toBe(200);

    const rows = await readAsTenant(RESTAURANT_A, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.messageType).toBe("image");
    expect(rows[0]?.body).toBeNull();
  });

  it("جسم أكبر من السقف: 413 برد فعلي، مش اتصال مقطوع", async () => {
    // السقف دفاع عن الذاكرة، بس تنفيذه سهل يطلع غلط: لو الطلب انهدّ
    // بـdestroy عشان نوقف التجميع، الرد بينكتب على مقبس ميّت والمرسِل
    // بيشوف ECONNRESET بدل رمز حالة. الاختبار هون على وصول الرد نفسه.
    const huge = JSON.stringify({ pad: "x".repeat(2 * 1024 * 1024) });

    const res = await postRaw(huge, sign(huge));

    expect(res.status).toBe(413);
  });

  it("حدث حالة تسليم (بلا messages): 200 وبلا كتابة", async () => {
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_TEST",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: PHONE_ID_A },
                statuses: [
                  {
                    id: wamid("status"),
                    status: "delivered",
                    recipient_id: CUSTOMER_PHONE,
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const res = await postRaw(body, sign(body));
    expect(res.status).toBe(200);
    expect(await countEverywhere(wamid("status"))).toBe(0);
  });
});

describe("POST /webhook — فشل التخزين", () => {
  /**
   * 🔴 هالمجموعة هي مقابل عطل "200 على كل شي".
   *
   *    فشل التخزين بيوصل بأشكال — قاعدة واقعة، قيد رفض، اتصال منقطع،
   *    deadlock، مهلة — وكلهم بينتهوا بنفس المكان: المعاملة انسحبت وما في
   *    صف. الرد الصح عليهم واحد: غير 200، عشان طابور إعادة الإرسال عند ميتا
   *    (٧ أيام) يشتغل. 200 هون معناها الرسالة انمسحت من الوجود.
   *
   *    ولا mock: الفشل بينعمل بالقاعدة الحقيقية.
   */

  it("قيد رفض أثناء الكتابة: 500 مش 200، وولا مطالبة انثبتت", async () => {
    // بنزرع الصف مسبقا باتصال التدقيق **بلا** مطالبة منع تكرار. فالبوابة
    // بتمر (المطالبة جديدة)، والتوجيه بينجح، وINSERT بيرتطم بـ
    // UNIQUE(restaurant_id, wa_message_id) — قيد رفض حقيقي من Postgres.
    const id = wamid("constraint-violation");
    await audit.query(
      `INSERT INTO inbound_messages
         (restaurant_id, wa_message_id, phone_number_id, from_phone,
          message_type, body, payload)
       VALUES ($1, $2, $3, $4, 'text', 'صف مزروع', '{}'::jsonb)`,
      [RESTAURANT_A, id, PHONE_ID_A, CUSTOMER_PHONE],
    );

    const res = await postSigned(
      metaPayload({ phoneNumberId: PHONE_ID_A, waMessageId: id }),
    );

    // 🔴 التأكيد المركزي.
    expect(res.status).toBe(500);

    // الصف المزروع لسا وحده — ما انكتب فوقه ولا انضاف تاني.
    expect(await countEverywhere(id)).toBe(1);
    // والمطالبة انسحبت مع المعاملة: بلاها إعادة الإرسال بتتصنّف "مكرر"
    // وبترجع 200 بلا ما تخزّن إشي — يعني الرسالة بتضيع رغم الـ500.
    expect(await countClaims(id)).toBe(0);
  });

  it("اتصال مقطوع: 500، وولا صف وولا مطالبة", async () => {
    // مخزن اتصالات مسكّر = "القاعدة مش موجودة" من وجهة نظر الكود. نفس
    // الشكل اللي بيصير فيه failover أو إعادة تشغيل Postgres تحت الحمل.
    const id = wamid("dead-pool");
    const deadDb = new TenantDb();
    await deadDb.stop();

    const deadServer = createWebhookServer({
      service: new WebhookService(deadDb),
      health: deadDb,
      verifyToken: env().WHATSAPP_WEBHOOK_VERIFY_TOKEN,
      appSecret: env().WHATSAPP_APP_SECRET,
    });
    await new Promise<void>((resolve) => {
      deadServer.listen(0, "127.0.0.1", resolve);
    });
    const deadUrl = `http://127.0.0.1:${
      (deadServer.address() as AddressInfo).port
    }`;

    try {
      const body = JSON.stringify(
        metaPayload({ phoneNumberId: PHONE_ID_A, waMessageId: id }),
      );
      const res = await fetch(`${deadUrl}/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": sign(body),
        },
        body,
      });

      expect(res.status).toBe(500);
      expect(await countEverywhere(id)).toBe(0);
      expect(await countClaims(id)).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        deadServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it("فشل تخزين بالفرع نفسه: ingest بترجّع failed، مش استثناء", async () => {
    // 🔴 الاختباران فوق بيفحصوا رمز الحالة — أثر جانبي. هذا بيفحص الفرع
    //    اللي مشى فعليا: القيمة اللي طلعت من ingest() هي "failed"، يعني
    //    الخطأ انمسك برسالة وحدة وما سقّط الدفعة، والمستدعي عنده معلومة
    //    كافية يرد فيها 500. لو صار الرد 500 لأن السيرفر انفجر بمكان تاني،
    //    هذا الاختبار بيضل يمسك الفرق.
    const id = wamid("failed-branch");
    await audit.query(
      `INSERT INTO inbound_messages
         (restaurant_id, wa_message_id, phone_number_id, from_phone,
          message_type, payload)
       VALUES ($1, $2, $3, $4, 'text', '{}'::jsonb)`,
      [RESTAURANT_A, id, PHONE_ID_A, CUSTOMER_PHONE],
    );

    const parsed = parseWebhookPayload(
      metaPayload({ phoneNumberId: PHONE_ID_A, waMessageId: id }),
    );
    if (parsed === null) throw new Error("الحمولة المبنية بالاختبار ما انقرأت");

    await expect(service.ingest(parsed)).resolves.toEqual(["failed"]);
    expect(needsRedelivery(["failed"])).toBe(true);
    expect(needsRedelivery(["stored", "duplicate"])).toBe(false);
  });

  it("رسالة سليمة ورسالة فاشلة بنفس الدفعة: السليمة تُخزَّن والرد 500", async () => {
    // إعادة الدفعة كاملة آمنة: اللي انخزن بتمسكه بوابة منع التكرار بالتسليم
    // الجاي، واللي فشل بياخد محاولة تانية. عشان هيك الرد على الدفعة كلها
    // 500 وما في تقسيم.
    const good = wamid("batch-good");
    const bad = wamid("batch-bad");
    await audit.query(
      `INSERT INTO inbound_messages
         (restaurant_id, wa_message_id, phone_number_id, from_phone,
          message_type, payload)
       VALUES ($1, $2, $3, $4, 'text', '{}'::jsonb)`,
      [RESTAURANT_A, bad, PHONE_ID_A, CUSTOMER_PHONE],
    );

    const res = await postSigned(
      metaPayload(
        { phoneNumberId: PHONE_ID_A, waMessageId: good, text: "سليمة" },
        { phoneNumberId: PHONE_ID_A, waMessageId: bad, text: "بترتطم بقيد" },
      ),
    );

    expect(res.status).toBe(500);
    // الرسالة السليمة ما انسحبت مع أختها — كل وحدة بمعاملتها.
    expect(await readAsTenant(RESTAURANT_A, good)).toHaveLength(1);
    expect(await countClaims(good)).toBe(1);
    expect(await countClaims(bad)).toBe(0);
  });
});

describe("POST /webhook — رقم بلا مطعم: الاسترجاع بعد تصليح الربط", () => {
  /**
   * 🔴 هالمجموعة هي جوهر المهمة.
   *
   *    العطل اللي كان: رقم مش معروف بيثبّت مطالبة منع التكرار وبيرجع 200 بلا
   *    ما يخزّن. النتيجة إن الرسالة بتصير **غير قابلة للاسترجاع للأبد**:
   *    ميتا شافت 200 فما بتعيد، ولو أعادت بتلاقي المطالبة مثبّتة فبتتصنّف
   *    "مكرر" وبترجع 200 تاني — حتى بعد ما ينتصلّح الربط وتصير الرسالة
   *    قابلة للتوجيه تماما.
   *
   *    فعدّ الصفوف لحاله ما بيكفي هون. التأكيد اللي بيثبت الإصلاح هو
   *    **غياب صف المطالبة**، وبعده إعادة نفس الرسالة حرفيا بعد تصليح الربط.
   */

  it("رقم مجهول ثم إصلاح الربط: 500 بلا مطالبة، وإعادة نفس الرسالة بتُخزَّن", async () => {
    const id = wamid("recover-after-fix");
    const phoneId = `PHONE_UNMAPPED.${RUN}`;
    // نفس الحمولة بالضبط بالمحاولتين — هيك بتعيد ميتا: بايتات متطابقة.
    const payload = metaPayload({
      phoneNumberId: phoneId,
      waMessageId: id,
      text: "بدي أطلب — وصلت قبل ما ينتربط الرقم",
    });

    // --- المحاولة الأولى: ما في مطعم على هالرقم ---------------------------
    const first = await postSigned(payload);

    expect(first.status).toBe(500);
    expect(await countEverywhere(id)).toBe(0);
    // 🔴 التأكيد المحوري بكل هالمهمة. لو صار 1 هون، المطالبة اتثبّتت على
    //    رسالة ما انخزنت، وكل إعادة إرسال جاية رح تتصنّف "مكرر" — الرسالة
    //    ماتت وما في طريق يرجّعها.
    expect(await countClaims(id)).toBe(0);

    // --- تصليح الربط: الرقم بينضاف لمطعم فعّال ----------------------------
    const restaurantId = await createRestaurant(phoneId, "active");

    // --- إعادة الإرسال: نفس الرسالة، نفس المعرّف --------------------------
    const second = await postSigned(payload);

    expect(second.status).toBe(200);
    const rows = await readAsTenant(restaurantId, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe("بدي أطلب — وصلت قبل ما ينتربط الرقم");
    expect(await countClaims(id)).toBe(1);
  });

  it("مطعم موقوف ثم رفع الإيقاف: نفس السلوك بالضبط", async () => {
    // الإيقاف بيمر من نفس الدالة: 0003 فيها
    // `AND status <> 'suspended'`، فبترجّع NULL زي الرقم المجهول تماما.
    // ولو انبلعت الرسالة بـ200، مطعم رجع من الإيقاف بيلاقي طلبات زبائنه
    // ضايعة من فترة الإيقاف — مش متأخرة، ضايعة.
    const id = wamid("suspended-then-active");
    const phoneId = `PHONE_SUSPENDED.${RUN}`;
    const restaurantId = await createRestaurant(phoneId, "suspended");
    const payload = metaPayload({
      phoneNumberId: phoneId,
      waMessageId: id,
      text: "وصلت والمطعم موقوف",
    });

    const first = await postSigned(payload);
    expect(first.status).toBe(500);
    expect(await countEverywhere(id)).toBe(0);
    expect(await countClaims(id)).toBe(0);

    await audit.query(
      "UPDATE restaurants SET status = 'active' WHERE id = $1",
      [restaurantId],
    );

    const second = await postSigned(payload);
    expect(second.status).toBe(200);
    expect(await readAsTenant(restaurantId, id)).toHaveLength(1);
  });

  it("الفرع نفسه: ingest بترجّع unroutable، وهي قابلة لإعادة الإرسال", async () => {
    // 🔴 الاختباران فوق بيفحصوا الأثر (رمز الحالة، عدّ الصفوف). هذا بيفحص
    //    الفرع اللي مشى فعليا. الفرق بيبان لو انكسر التوجيه بشكل تاني:
    //    استثناء عام بالمعاملة كمان بيرجّع 500 وبيخلي عدّ المطالبات صفر —
    //    يعني الاختباران فوق بيمروا وهم مبسوطين بينما التشخيص غلط تماما.
    //    "unroutable" بتقول: البوابة مشت، والتوجيه هو اللي قال ما في مطعم.
    const id = wamid("unroutable-branch");
    const parsed = parseWebhookPayload(
      metaPayload({ phoneNumberId: PHONE_ID_UNKNOWN, waMessageId: id }),
    );
    if (parsed === null) throw new Error("الحمولة المبنية بالاختبار ما انقرأت");

    await expect(service.ingest(parsed)).resolves.toEqual(["unroutable"]);
    expect(needsRedelivery(["unroutable"])).toBe(true);
    expect(await countClaims(id)).toBe(0);
  });

  it("المطالبة بتضل مسحوبة مهما تكرّرت المحاولة", async () => {
    // ثلاث إعادات إرسال على رقم لسا مش مربوط. لو وحدة منهم ثبّتت مطالبة،
    // الرابعة — اللي بتيجي بعد التصليح — بتتصنّف "مكرر" وبتضيع الرسالة.
    // يعني الخاصية لازم تصمد على التكرار، مش على أول محاولة بس.
    const id = wamid("repeated-unroutable");
    const phoneId = `PHONE_STILL_UNMAPPED.${RUN}`;
    const payload = metaPayload({
      phoneNumberId: phoneId,
      waMessageId: id,
    });

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await postSigned(payload);
      expect(res.status).toBe(500);
      expect(await countClaims(id)).toBe(0);
    }

    const restaurantId = await createRestaurant(phoneId, "active");
    const recovered = await postSigned(payload);
    expect(recovered.status).toBe(200);
    expect(await readAsTenant(restaurantId, id)).toHaveLength(1);
  });
});
describe("GET /health — الفحص لازم يلمس القاعدة", () => {
  /**
   * 🔴 فحص صحة ما بيلمس القاعدة بيكذب بأسوأ لحظة.
   *
   *    العملية بتضل عايشة والقاعدة واقعة، فالمنسّق بيشوف 200 وبيضل يوجّه
   *    الطلبات، والمستقبِل بيضل يبلع رسائل الزبائن طول العطل. الفحص اللي
   *    بيسقط بيخلي العملية تنشال من الدوران، وميتا بتشوف غير-200 وبتحتفظ
   *    بالرسائل بطابورها لحد ما ترجع القاعدة.
   */

  it("قاعدة شغّالة: 200 و ok", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("قاعدة غير متاحة: غير 200", async () => {
    // مخزن اتصالات مسكّر — نفس اللي بيصير بإعادة تشغيل Postgres أو failover.
    // 🔴 لو الفحص ما بيلمس القاعدة، ما في طريقة يفشل فيها هون: بيرجّع 200
    //    وهو مغمّض. فهذا الاختبار هو اللي بيثبت إنه بيلمسها فعلا.
    const deadDb = new TenantDb();
    await deadDb.stop();

    const deadServer = createWebhookServer({
      service: new WebhookService(deadDb),
      health: deadDb,
      verifyToken: env().WHATSAPP_WEBHOOK_VERIFY_TOKEN,
      appSecret: env().WHATSAPP_APP_SECRET,
    });
    await new Promise<void>((resolve) => {
      deadServer.listen(0, "127.0.0.1", resolve);
    });
    const deadUrl = `http://127.0.0.1:${
      (deadServer.address() as AddressInfo).port
    }`;

    try {
      const res = await fetch(`${deadUrl}/health`);

      expect(res.status).not.toBe(200);
      // 503 تحديدا: العطل بالاعتمادية ومؤقت، والمنسّق بيقرأها "شيلني من
      // الدوران" مش "الطلب غلط".
      expect(res.status).toBe(503);
    } finally {
      await new Promise<void>((resolve, reject) => {
        deadServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it("الفرع نفسه: الرد بيقول إنه فرع القاعدة اللي مشى، مش رمز حالة بس", async () => {
    // 🔴 رمز الحالة أثر. الجسم هو اللي بيميّز الفرعين:
    //
    //      نجح الفحص  -> { ok: true }
    //      فشل الفحص  -> { ok: false, error: "database_unavailable" }
    //
    //    معالج بيبلع خطأ الفحص وبيرجّع 200 بيرجّع جسم الفرع التاني — وهاد
    //    اللي بينمسك هون. ولولا هالتأكيد، أي 503 من أي مكان بالمسار بيرضّي
    //    الاختبار اللي فوق.
    const deadDb = new TenantDb();
    await deadDb.stop();
    const dead = await serverOn(deadDb);

    try {
      const res = await fetch(`${dead.url}/health`);
      expect(await res.json()).toEqual({
        ok: false,
        error: "database_unavailable",
      });
    } finally {
      await dead.close();
    }
  });

  it("قاعدة موجودة عالشبكة بس بترفض: كمان غير 200", async () => {
    // فشل من نوع تاني تماما: TCP بيوصل وPostgres بيرد بالرفض. الفرع لازم
    // يكون واحد — "ما قدرت أوصل القاعدة" — مش حالة خاصة بمخزن مسكّر.
    const refusedDb = new TenantDb(missingDatabaseUrl());
    const refused = await serverOn(refusedDb);

    try {
      const res = await fetch(`${refused.url}/health`);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        ok: false,
        error: "database_unavailable",
      });
    } finally {
      await refused.close();
      await refusedDb.stop();
    }
  });

  it("الفرع نفسه: ping بيمرّر على قاعدة شغّالة وبيرمي على مسكّرة", async () => {
    // 🔴 الاختباران فوق بيفحصوا رمز الحالة — أثر. هذا بيفحص الاستعلام نفسه:
    //    ping() بتوصل القاعدة وبترجع، وبترمي لما ما توصل. لو انمسح جسمها
    //    وصارت `async ping() {}` فاضية، الاختباران فوق ممكن يضلوا يمروا لو
    //    صار الفشل بمكان تاني بالمسار — هذا ما بيمر.
    await expect(db.ping()).resolves.toBeUndefined();

    const deadDb = new TenantDb();
    await deadDb.stop();
    await expect(deadDb.ping()).rejects.toThrow();
  });
});
