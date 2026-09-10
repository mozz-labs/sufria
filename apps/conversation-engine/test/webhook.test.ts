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
 *   4. رقم مش معروف = ولا صف بأي مكان بالجدول، مش صف عند مطعم غلط.
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
  it("رقم غير معروف: 200، وولا صف بأي مكان بالجدول", async () => {
    const id = wamid("unknown-phone");

    const res = await postSigned(
      metaPayload({ phoneNumberId: PHONE_ID_UNKNOWN, waMessageId: id }),
    );

    // 200 مش 500: رقم مش معروف إعداد غلط عند ميتا، مش عطل بالنظام.
    expect(res.status).toBe(200);

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
