import { z } from "zod";

/**
 * الإعدادات بتتفحص عند الإقلاع — مش عند أول webhook.
 *
 * الفرق مش شكلي: لو WHATSAPP_APP_SECRET ناقص وما فحصناه هون، السيرفر بيقلع
 * وبيستقبل طلبات، وكل تحقق توقيع بيفشل — يعني كل رسالة زبون بترجع 401 وميتا
 * بتخفّض تقييم الرقم. الانفجار عند الإقلاع أرخص بكتير.
 */
const EnvSchema = z.object({
  // 🔴 sufria_engine — مش postgres. دور superuser بيلغي RLS بصمت،
  //    و tenant-db.ts بيرفض يقلع لو صار (نفس فحص الداشبورد).
  ENGINE_DATABASE_URL: z
    .string()
    .min(1, "ENGINE_DATABASE_URL مفقود — انسخ .env.example لـ.env"),

  // النص اللي بتحطه بإعدادات الـwebhook عند ميتا. بينقارن مع hub.verify_token.
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z
    .string()
    .min(1, "WHATSAPP_WEBHOOK_VERIFY_TOKEN مفقود — بلاه ما في اشتراك webhook"),

  // من إعدادات التطبيق عند ميتا. مفتاح HMAC لتوقيع X-Hub-Signature-256.
  WHATSAPP_APP_SECRET: z
    .string()
    .min(1, "WHATSAPP_APP_SECRET مفقود — بلاه ما في تحقق توقيع"),

  ENGINE_PORT: z.coerce.number().int().positive().default(3001),
  PG_POOL_MAX: z.coerce.number().int().positive().default(10),

  // 🔴 مهلات مخزن الاتصالات. الافتراضي عند pg بكل وحدة منهم هو **انتظار
  //    أبدي**، وهاد مش تحفّظ — هو أسوأ سلوك ممكن هون. مخزن مشبّع أو قاعدة
  //    ما بترد بيعلّقوا معالج الـwebhook للأبد، وميتا بتقطع الطلب من طرفها
  //    بلا رد، والمعالجات المعلّقة بتتكدّس لحد ما تموت العملية بلا سبب باين.
  //    مهلة بتخلّي الفشل صريح وسريع، والرد بيصير 500 وميتا بتعيد الإرسال.

  /** انتظار اتصال حر من المخزن (أو فتح اتصال جديد). */
  PG_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
  /** Postgres بيلغي الاستعلام. جهة الخادم. */
  PG_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  /**
   * pg بيستسلم عن القراءة. جهة العميل، وشبكة أمان خلف اللي قبله:
   * لازم تكون **أكبر** من statement_timeout عشان إلغاء الخادم يفوز بالعادة
   * (خطأ نظيف والاتصال بيضل صالح)، وهاي ما بتشتغل إلا لما الخادم ما يرد
   * أصلا — شبكة انقطعت بنص استعلام.
   */
  PG_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join(".")}: ${i.message}`,
    );
    throw new Error(`إعدادات البيئة غير صالحة:\n${lines.join("\n")}`);
  }
  cached = parsed.data;
  return cached;
}
