import { claimWebhookEvent } from "../db/critical-primitives.js";
import {
  resolveRestaurantByPhoneId,
  setTenantContext,
  type TenantDb,
} from "../db/tenant-db.js";
import { inboundMessages } from "../db/schema.js";
import { logger, maskPhone } from "../logger.js";
import type { InboundMessage, ParsedWebhook } from "./payload.js";

/** نتيجة معالجة رسالة واحدة. مكشوفة عشان الاختبارات تتأكد من الفرع اللي مشى. */
export type IngestOutcome =
  "stored" | "duplicate" | "unknown_phone_id" | "failed";

/**
 * النتائج اللي لازم ميتا تعيد إرسالها.
 *
 * 🔴 هاي هي الترجمة الحرفية لقاعدة الردود: 200 يعني "خزّنتها بأمان أو تجاهلتها
 *    بقصد ونهائيا". أي شي تاني يعني "ما قدرت" — وميتا عندها طابور إعادة إرسال
 *    بتردد متناقص لحد ٧ أيام، مجانا، على أي رد غير 200. رمي الطابور هذا
 *    وإرجاع 200 على فشل تخزين بيعني إن رسالة زبون حقيقية بتضيع نهائيا وبصمت.
 */
const RETRYABLE: ReadonlySet<IngestOutcome> = new Set<IngestOutcome>([
  "failed",
]);

/** true لو في ولو نتيجة وحدة بتحتاج إعادة إرسال. المستدعي بيرد 500. */
export function needsRedelivery(outcomes: readonly IngestOutcome[]): boolean {
  return outcomes.some((outcome) => RETRYABLE.has(outcome));
}

/**
 * استقبال الرسائل الواردة: بوابة منع التكرار، ثم التوجيه، ثم التخزين.
 *
 * ⛔ حدود هالشريحة: ولا سطر عن آلة حالات الطلب، ولا إرسال أي رسالة، ولا منطق
 *    قائمة. الملف هذا بيستقبل وبيخزّن وبيسكت.
 */
export class WebhookService {
  constructor(private readonly db: TenantDb) {}

  /**
   * ميتا بتجمّع كذا رسالة بطلب واحد. كل وحدة بمعاملتها وبمحاولتها المستقلة:
   * رسالة فشلت ما بتسقّط اللي بعدها، ومنع التكرار بيضل صح لكل وحدة لحالها.
   *
   * 🔴 المصفوفة المرجَّعة مش سجل — هي الرد. المستدعي لازم يفحصها
   *    بـneedsRedelivery(). رميها بيرجّع الملف لعطل "200 على كل شي".
   */
  async ingest(parsed: ParsedWebhook): Promise<IngestOutcome[]> {
    const outcomes: IngestOutcome[] = [];
    for (const message of parsed.messages) {
      outcomes.push(await this.ingestOne(message));
    }
    return outcomes;
  }

  private async ingestOne(message: InboundMessage): Promise<IngestOutcome> {
    try {
      return await this.db.runUnscoped(async (tx) => {
        // ---------------------------------------------------------------
        // ١. بوابة منع التكرار — أول شي بعد التوقيع، قبل أي منطق.
        //
        // processed_webhook_events بلا RLS بالتصميم (0001/0003): البوابة
        // بتشتغل قبل ما يكون في سياق مستأجر أصلا، وهاد بالضبط ليش المعاملة
        // بتبلّش unscoped وبتكتسب السياق بنصّها.
        //
        // claimWebhookEvent من critical-primitives.ts — ما بتنعاد كتابتها.
        // هي INSERT ... ON CONFLICT DO NOTHING RETURNING بعملية ذرية وحدة:
        // إعادتا إرسال بفارق ميلي ثانية ما بيقدروا يفوزوا الاتنين.
        // ---------------------------------------------------------------
        if (!(await claimWebhookEvent(tx, message.waMessageId, "whatsapp"))) {
          logger.debug(
            { waMessageId: message.waMessageId },
            "حدث مكرر — تجاهل صامت",
          );
          return "duplicate";
        }

        // ---------------------------------------------------------------
        // ٢. التوجيه: phone_number_id -> restaurant_id.
        //
        // التجاوز الوحيد المسموح للمحرّك (0003، دالة SECURITY DEFINER).
        // ---------------------------------------------------------------
        const restaurantId = await resolveRestaurantByPhoneId(
          tx,
          message.phoneNumberId,
        );

        if (restaurantId === null) {
          logger.warn(
            {
              phoneNumberId: message.phoneNumberId,
              waMessageId: message.waMessageId,
            },
            "phone_number_id غير معروف — الرسالة ما انسندت لأي مطعم",
          );
          return "unknown_phone_id";
        }

        // ---------------------------------------------------------------
        // ٣. السياق قبل أي كتابة. من هون وطالع كل شي تحت RLS.
        // ---------------------------------------------------------------
        await setTenantContext(tx, restaurantId);

        await tx.insert(inboundMessages).values({
          restaurantId,
          waMessageId: message.waMessageId,
          phoneNumberId: message.phoneNumberId,
          fromPhone: message.from,
          messageType: message.type,
          body: message.body,
          payload: message.raw,
          sentAt: message.sentAt,
        });

        logger.info(
          {
            restaurantId,
            waMessageId: message.waMessageId,
            from: maskPhone(message.from),
            type: message.type,
          },
          "رسالة واردة انخزنت",
        );
        return "stored";
      });
    } catch (error) {
      // 🔴 المعاملة انسحبت كاملة، والمطالبة معها — يعني إعادة إرسال من ميتا
      //    بتقدر تنجح. عشان هيك هالنتيجة قابلة لإعادة الإرسال والرد بيصير
      //    500: القاعدة الواقعة، قيد الرفض، الاتصال المقطوع، الـdeadlock
      //    والمهلة كلهم بيوصلوا لهون، وكلهم "ما قدرت" مش "خلصت".
      logger.error(
        {
          waMessageId: message.waMessageId,
          phoneNumberId: message.phoneNumberId,
          err: error,
        },
        "فشل استقبال رسالة واردة — الرد بيصير 500 وميتا بتعيد الإرسال",
      );
      return "failed";
    }
  }
}
