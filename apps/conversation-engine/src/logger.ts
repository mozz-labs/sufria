import pino from "pino";
import { env } from "./config/env.js";

/**
 * 🔴 لا تسجّل نص الرسالة ولا رقم الزبون كامل.
 *
 * سجلات الـwebhook بتروح لخدمة استضافة طرف ثالث. محتوى محادثة زبون مع مطعم
 * بيندرج تحت بيانات شخصية، وسطر log واحد فيه العنوان أو رقم البطاقة ما بينمسح
 * من السجلات بعدين. الحقول المسموحة: معرّفات، أنواع، نتائج.
 */
export const logger = pino({
  level: env().LOG_LEVEL,
  base: { service: "conversation-engine" },
});

/** آخر أربع خانات بس — كافي للتتبّع، ما بيعرّف حدا لحاله. */
export function maskPhone(phone: string): string {
  return phone.length <= 4 ? "****" : `****${phone.slice(-4)}`;
}
