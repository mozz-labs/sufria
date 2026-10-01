/**
 * بيشتغل قبل إطار الاختبار، عشان أي ملف بيستورده الاختبار يلاقي process.env
 * معبّاة أصلا.
 *
 * config/env.ts بتقرأ process.env مرة وحدة وبتخزّنها، وبترمي لو ناقص إشي.
 * لو المتغيّرات ما انحطّت قبل أول import، السويت بتفشل عند الاستيراد برسالة
 * "إعدادات البيئة غير صالحة" بدل ما تفشل بمكان بيقول لك إشي.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// البيئة الحقيقية بتفوز. الـCI بيصدّر الروابط مباشرة وما عنده ملف .env.
function loadDotEnv(path: string): void {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv(resolve(__dirname, "../../../.env"));

process.env["NODE_ENV"] = "test";

/**
 * 🔴 فاضي = غايب، مش قيمة.
 *
 * `??=` بتفرّق بينهم، والفرق هون غلط: .env.example بيجي بـ
 * `WHATSAPP_APP_SECRET=` بلا قيمة، فأول واحد بينسخه بياخد نص فاضي مش
 * undefined — و`??=` بتحترمه، وZod بترفضه بـmin(1)، والسويت بتفشل عند
 * الاستيراد على جهاز نظيف تماما بينما بتمر على أجهزة اللي عبّوا الملف.
 */
function fallback(key: string, value: string): void {
  if (!process.env[key]) process.env[key] = value;
}

/**
 * السجلات بتغرق مخرجات Jest بلا فايدة — الاختبارات بتفحص القاعدة والردود،
 * مش سطور الـlog. وLOG_LEVEL جاي من .env بقيمة الإنتاج/التطوير (debug عادة)،
 * فما بينفع يحكم ضجيج السويت. للتشخيص: TEST_LOG_LEVEL=debug pnpm test.
 */
process.env["LOG_LEVEL"] = process.env["TEST_LOG_LEVEL"] || "silent";

/**
 * أسرار خاصة بالتشغيل. عمرها عمر عملية الاختبار، وبتتحقق بنفس العملية.
 * ولا وحدة منهم مسار إنتاج: NODE_ENV = "test" فوق، وأي نشر حقيقي بيقرأ
 * القيم من بيئته هو، واللي بتسبق هالسطور.
 */
fallback("WHATSAPP_APP_SECRET", "test-only-app-secret-not-used-elsewhere");
fallback("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "test-only-verify-token");

// 🔴 اتصال واحد، عشان "هل تسرّب السياق على الاتصال المجمّع؟" يصير سؤال حاسم.
// بمخزن أكبر، الاستعلام اللي بعده ممكن يقع على عضو تاني، واختبار التسريب
// بيمر بلا ما يثبت إشي.
process.env["PG_POOL_MAX"] = "1";

/**
 * 🔴 توكن وهمي. السويت ما بتضرب Graph API إطلاقا — كل اختبار بيوصل
 * RecordingWhatsAppSender، وMetaWhatsAppSender ما بينبنى ولا مرة بالاختبارات.
 * القيمة موجودة عشان env() تمر بس، لأنها بتفحص كل المتغيّرات عند أول import.
 */
fallback("WHATSAPP_ACCESS_TOKEN", "test-only-access-token-never-sent-anywhere");

/**
 * 🔴 مُراقِب الإشعارات مطفأ بالاختبارات (بريف و §1.5). الاختبارات بتنادي
 * `tick()` مباشرة — مؤقّت شغّال كان بيلتقط طلبات سويتات تانية بالتوقيت.
 */
process.env["NOTIFY_POLL_MS"] = "0";

/**
 * 🔴 مهلة الجلسة مثبّتة على قيمتها الافتراضية، بغض النظر عن .env. بريف ح
 *    بيطلب من محمد يحط `SESSION_IDLE_MINUTES=1` مؤقتا ليجرّب على جهازه — ولو
 *    السويت قرأتها، اختبار «59 دقيقة ← ما بتنتهي» كان بيسقط، والأخطر إن
 *    أي اختبار بيسكت دقيقة كان بيلاقي جلسته منتهية بلا سبب ظاهر.
 */
process.env["SESSION_IDLE_MINUTES"] = "60";
