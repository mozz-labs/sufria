import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * التحقق من X-Hub-Signature-256.
 *
 * 🔴 الحساب على البايتات الخام للجسم — مش على JSON.stringify(JSON.parse(body)).
 *
 * هاي مش نقطة أسلوب. أي body parser بيعطيك كائن، وإعادة تسلسله بتغيّر ترتيب
 * المفاتيح والمسافات وترميز المحارف غير اللاتينية. الحمولات هون عربية، يعني
 * إعادة التسلسل بتغيّر البايتات فعليا، والتوقيع بيفشل ١٠٠٪ من الوقت — وبتضيع
 * يوم كامل تدوّر على "ليش ميتا بتبعت توقيع غلط".
 *
 * ولهيك السيرفر بـhttp/server.ts بيقرأ Buffer خام وما بيمرّره على JSON.parse
 * إلا بعد ما هالدالة تخلص.
 */
const PREFIX = "sha256=";

export function verifySignature(
  rawBody: Buffer,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!header || !header.startsWith(PREFIX)) return false;

  const provided = header.slice(PREFIX.length);
  // hex بس. Buffer.from بيتجاهل المحارف غير الصالحة بصمت، يعني "zz" بتصير
  // مخزن فاضي — وبلا هالفحص، توقيع فاضي وتوقيع مشوّه بيوصلوا لنفس المقارنة.
  if (!/^[0-9a-f]+$/i.test(provided)) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const providedBuf = Buffer.from(provided, "hex");

  // timingSafeEqual بترمي لو الأطوال اختلفت، فالفحص قبلها مش تحسين.
  if (providedBuf.length !== expected.length) return false;
  return timingSafeEqual(providedBuf, expected);
}

/**
 * مقارنة توكن تحقق الاشتراك بزمن ثابت.
 *
 * التوكن هذا سرّ مشترك ثابت، وGET /webhook مفتوحة للعالم بحكم تعريفها. مقارنة
 * `===` بتخرج عند أول بايت مختلف، وهاد تسريب بيسمح باستنتاج التوكن حرف حرف.
 */
export function safeTokenEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
