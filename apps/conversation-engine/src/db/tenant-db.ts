import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool, type QueryConfig } from "pg";
import * as schema from "@sufria/shared";
import { env } from "../config/env.js";
import type { TenantTx } from "./types.js";

/**
 * الطريقة الوحيدة اللي محرّك المحادثة بيلمس فيها القاعدة.
 *
 * الفرق عن TenantDbService بالداشبورد مقصود ومحصور بإشي واحد: الداشبورد بيعرف
 * المطعم قبل ما يفتح المعاملة (الحارس تحقق من العضوية)، فبيقدر يضبط السياق
 * وينساه. المحرّك ما بيعرف — بيبلش من phone_number_id وما عنده موظف مسجّل دخول.
 * يعني المعاملة لازم تبلّش بلا سياق (بوابة منع التكرار)، وتكتسب السياق بنصّها.
 *
 * ولهيك setTenantContext مكشوفة كخطوة صريحة مش مخفية جوّا runInTenant: الترتيب
 * هون جزء من الصحّة، مش تفصيل تنفيذ.
 *
 * الخصائص الثلاث اللي هذا الصنف موجود عشانها هي نفسها بالضبط:
 *   1. الضبط والاستعلام بنفس المعاملة — نفس الاتصال، ما بينفصلوا على عضوين
 *      مختلفين من المخزن.
 *   2. is_local = true — السياق بيموت مع المعاملة. SET عادي بيضل على الاتصال
 *      المجمّع وبيرثه الطلب اللي بعده.
 *   3. المعرّف bind parameter — لأن `SET LOCAL x = '<id>'` ما بتقبل واحد،
 *      ودمج النص بالـSQL بيحط ثغرة حقن جوّا حدود المستأجر نفسها.
 */
/** مهلة استعلام فحص الصحة. أقصر من مهلة الاستعلام العامة بالقصد. */
const HEALTH_QUERY_TIMEOUT_MS = 2000;

/**
 * pg بيقرأ query_timeout من إعداد الاستعلام نفسه (lib/client.js: `config
 * .query_timeout || this.connectionParameters.query_timeout`)، بس @types/pg
 * ما بيعرّفها على QueryConfig. التوسعة هون بدل ما نرمي النوع كله بـany.
 */
interface TimedQueryConfig extends QueryConfig {
  query_timeout: number;
}

export class TenantDb {
  private readonly pool: Pool;
  private readonly db: NodePgDatabase<typeof schema>;

  /**
   * الرابط اختياري وافتراضه ENGINE_DATABASE_URL — يعني كل كود التطبيق بينادي
   * `new TenantDb()` وبس.
   *
   * الوسيط موجود عشان الاختبارات تقدر تبني مخزن على قاعدة **غير متاحة فعلا**
   * (منفذ مسكّر، اسم قاعدة مش موجود) بدل ما تزيّف الفشل بـmock. فحص الصحة
   * تحديدا ما بينثبت إلا بقاعدة ساقطة حقيقية.
   */
  constructor(connectionString: string = env().ENGINE_DATABASE_URL) {
    this.pool = new Pool({
      connectionString,
      max: env().PG_POOL_MAX,
    });
    this.db = drizzle(this.pool, { schema });
  }

  /**
   * بيرفض الإقلاع لو ENGINE_DATABASE_URL بيوصل كـsuperuser أو دور BYPASSRLS.
   *
   * مزوّدو Postgres المُدارة بيعطوك رابط admin افتراضيا، ولصقه بالمتغيّر
   * بيعطّل كل سياسات 0003 بلا ولا رسالة خطأ. الانفجار هون قبل ما ينفتح المنفذ.
   */
  async start(): Promise<void> {
    // execute() بترجّع QueryResult مش مصفوفة — الصفوف بـ.rows.
    const res = await this.db.execute<{
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    const row = res.rows[0];
    if (row?.rolsuper || row?.rolbypassrls) {
      throw new Error(
        "ENGINE_DATABASE_URL يتصل كـsuperuser أو دور BYPASSRLS. " +
          "سياسات RLS متجاوَزة وعزل المستأجرين مطفي. استعمل دور sufria_engine.",
      );
    }
  }

  async stop(): Promise<void> {
    await this.pool.end();
  }

  /**
   * استعلام تافه على القاعدة، بمهلة قصيرة. بترمي لو ما وصل.
   *
   * 🔴 هذا اللي بيخلي /health يعني إشي.
   *
   *    فحص صحة ما بيلمس القاعدة بيجاوب على سؤال واحد: هل العملية عايشة؟
   *    والعملية بتضل عايشة تماما والقاعدة واقعة — فتضل "سليمة" بنظر
   *    المنسّق (Fly/Railway/K8s)، وتضل تستقبل webhooks، وتضل تبلع كل رسالة
   *    زبون طول فترة العطل. فحص بيلمس القاعدة بيسقط، والمنسّق بيوقف توجيه
   *    الطلبات، وميتا بتشوف غير-200 وبتحتفظ بالرسائل بطابورها.
   *
   *    المهلة قصيرة بالقصد وأقصر من مهلة الاستعلام العامة: فحص صحة بيعلّق
   *    عشر ثواني هو نفسه عطل — المنسّق بيعتبره timeout ومصنّفه "مش سليم"
   *    بعد ما يكون علّق خيط الفحص طول هالمدة.
   */
  async ping(): Promise<void> {
    const probe: TimedQueryConfig = {
      text: "SELECT 1",
      query_timeout: HEALTH_QUERY_TIMEOUT_MS,
    };
    await this.pool.query(probe);
  }

  /**
   * معاملة بلا سياق مستأجر.
   *
   * الاستعمال المشروع الوحيد: الخطوات اللي بتسبق معرفة المطعم — بوابة منع
   * التكرار (processed_webhook_events بلا RLS بالتصميم) وحلّ phone_number_id.
   * أي قراءة أو كتابة لجدول مربوط بمطعم بترجع صفر صفوف هون، وهاد المطلوب.
   */
  async runUnscoped<T>(work: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => work(tx as TenantTx));
  }

  /** معاملة سياقها مضبوط من أول سطر. للقراءات اللي بتعرف مطعمها مسبقا. */
  async runInTenant<T>(
    restaurantId: string,
    work: (tx: TenantTx) => Promise<T>,
  ): Promise<T> {
    return this.runUnscoped(async (tx) => {
      await setTenantContext(tx, restaurantId);
      return work(tx);
    });
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * بيضبط app.current_restaurant_id لباقي المعاملة الحالية.
 *
 * المعرّف بينفحص شكله هون كمان رغم إنه جاي من القاعدة نفسها
 * (resolve_restaurant_by_phone_id بترجّع uuid). الفحص مش عن عدم الثقة بالقاعدة
 * — هو عن إن هالدالة عامة، وأول مستدعي بيمرّرلها نص من حمولة webhook بيلاقي
 * الرفض هون بدل ما يلاقيه بسياسة RLS بعد أسبوعين.
 */
export async function setTenantContext(
  tx: TenantTx,
  restaurantId: string,
): Promise<void> {
  if (!UUID_RE.test(restaurantId)) {
    throw new Error(`سياق مستأجر غير صالح: ${restaurantId}`);
  }
  await tx.execute(
    sql`SELECT set_config('app.current_restaurant_id', ${restaurantId}, true)`,
  );
}

/**
 * phone_number_id -> restaurant_id عبر التجاوز الوحيد المسموح للمحرّك.
 *
 * app.resolve_restaurant_by_phone_id دالة SECURITY DEFINER معرّفة بـ0003
 * وممنوحة لـsufria_engine وحده. هي البديل عن إعطاء المحرّك BYPASSRLS: بتجاوب
 * على سؤال واحد وبترجّع عمود واحد، وكل شي بعدها بيمشي تحت RLS عادي.
 *
 * بترجّع null لرقم مش معروف ولمطعم موقوف. الاتنين حالة قابلة للتصليح — رقم
 * بينضاف للمطعم، وإيقاف بينرفع — فالمستدعي بيرد 500 وبيسحب مطالبة منع التكرار
 * عشان إعادة الإرسال من ميتا تلاقي الربط مصلَّح وتنجح. شوف
 * UnroutableMessageError بـwhatsapp/webhook.service.ts.
 */
export async function resolveRestaurantByPhoneId(
  tx: TenantTx,
  phoneNumberId: string,
): Promise<string | null> {
  const res = await tx.execute<{ restaurant_id: string | null }>(
    sql`SELECT app.resolve_restaurant_by_phone_id(${phoneNumberId}) AS restaurant_id`,
  );
  return res.rows[0]?.restaurant_id ?? null;
}
