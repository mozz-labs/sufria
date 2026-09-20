import {
  flushDeferred,
  type ConversationService,
  type DeferredSend,
} from "../conversation/session.service.js";
import { claimWebhookEvent } from "../db/critical-primitives.js";
import {
  resolveRestaurantByPhoneId,
  setTenantContext,
  type TenantDb,
} from "../db/tenant-db.js";
import { inboundMessages } from "@sufria/shared";
import { logger, maskPhone } from "../logger.js";
import type { InboundMessage, ParsedWebhook } from "./payload.js";

/** نتيجة معالجة رسالة واحدة. مكشوفة عشان الاختبارات تتأكد من الفرع اللي مشى. */
export type IngestOutcome =
  /** انكتبت تحت مطعمها. 200. */
  | "stored"
  /** بوابة منع التكرار مسكتها — انعالجت قبل هيك. 200. */
  | "duplicate"
  /** ما في مطعم فعّال على هالـphone_number_id. 500، والمطالبة انسحبت. */
  | "unroutable"
  /** فشل تخزين: قاعدة واقعة، قيد رفض، اتصال منقطع، deadlock، مهلة. 500. */
  | "failed";

/**
 * phone_number_id ما إله مطعم فعّال — رقم مش معنا، أو مطعم موقوف.
 *
 * 🔴 بترمي بالقصد، وبتنرمى **جوّا** المعاملة، عشان المعاملة تنسحب والمطالبة
 *    تنسحب معها. هاد مش تفصيل أسلوب:
 *
 *    الثابت اللي هالملف بيحافظ عليه هو "المطالبة بتثبت إذا وإذا فقط الرسالة
 *    انخزنت (أو كانت مكرر حقيقي)". لو المطالبة ثبتت والرسالة ما انخزنت، أي
 *    إعادة إرسال جاية بتتصنّف "مكرر" وبترجع 200 بلا ما تخزّن إشي — يعني
 *    الرسالة بتصير غير قابلة للاسترجاع **للأبد**، حتى بعد ما ينتصلّح الربط
 *    عند ميتا أو يرجع المطعم من الإيقاف. والرسالة الوحيدة اللي بعتها الزبون
 *    ما إلها نسخة تانية بأي مكان.
 *
 *    وبما إن كل خطوات ingestOne جوّا معاملة وحدة، الانسحاب هو القاعدة العامة:
 *    أي فشل بعد المطالبة بيلغيها. عشان هيك الرمي، مش `return`.
 */
class UnroutableMessageError extends Error {
  constructor(readonly phoneNumberId: string) {
    super(`ما في مطعم فعّال على phone_number_id: ${phoneNumberId}`);
    this.name = "UnroutableMessageError";
  }
}

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
  "unroutable",
]);

/** true لو في ولو نتيجة وحدة بتحتاج إعادة إرسال. المستدعي بيرد 500. */
export function needsRedelivery(outcomes: readonly IngestOutcome[]): boolean {
  return outcomes.some((outcome) => RETRYABLE.has(outcome));
}

/**
 * استقبال الرسائل الواردة: بوابة منع التكرار، ثم التوجيه، ثم التخزين، ثم خطوة
 * المحادثة (بوابة ساعات الدوام والجلسة وأول رد).
 *
 * ⛔ حدود هالشريحة: ولا سلة، ولا عنوان، ولا دفع، ولا إنشاء طلب. خطوة المحادثة
 *    كلها بـconversation/session.service.ts، وهالملف بيضل مسؤول عن شي واحد:
 *    إن الرسالة الواردة تنخزّن تحت مطعمها مرة وحدة بالضبط.
 */
export class WebhookService {
  /**
   * 🔴 `conversation` إجبارية مش اختيارية. اعتمادية اختيارية معناها إن محرّكا
   *    منشورا بلا توصيل صحيح بيستقبل وبيخزّن ويسكت، وولا اختبار بيلاحظ —
   *    والعطل بيبان لما زبون حقيقي يبعت رسالة وما يجيه رد.
   */
  constructor(
    private readonly db: TenantDb,
    private readonly conversation: ConversationService,
  ) {}

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
    // طابور ما بعد الـCOMMIT — بينعبّى جوّا المعاملة وبينفرّغ بعدها (ج §8).
    const deferred: DeferredSend[] = [];
    try {
      const outcome = await this.db.runUnscoped(async (tx) => {
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

        // 🔴 رقم مش معروف أو مطعم موقوف = ما قدرنا، مش خلصنا.
        //
        //    الاتنين بيرجعوا NULL من نفس الدالة (0003: `WHERE
        //    whatsapp_phone_id = $1 AND status <> 'suspended'`)، والاتنين
        //    حالتهم قابلة للتصليح: رقم بينضاف للمطعم، وإيقاف بينرفع. فالرد
        //    الصح 500 وترك الرسالة بطابور ميتا لحد ما يتصلّح الربط — مش
        //    ابتلاعها بـ200 وضياعها.
        //
        //    والرمي هون هو اللي بيسحب مطالبة منع التكرار. شوف
        //    UnroutableMessageError فوق.
        if (restaurantId === null) {
          throw new UnroutableMessageError(message.phoneNumberId);
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

        // ---------------------------------------------------------------
        // ٤. خطوة المحادثة — بنفس المعاملة وبنفس السياق.
        //
        // 🔴 بعد التخزين، مش قبله. لو انعكس الترتيب، فشل بأي خطوة من خطوات
        //    المحادثة بيسحب معه تخزين رسالة الزبون — والرسالة الواردة هي
        //    الشي الوحيد اللي ما إله نسخة تانية عندنا.
        //
        //    ونتيجتها ما بتغيّر رد الـwebhook: كل فروعها نهائية (رحّبنا، أو
        //    المطعم مغلق، أو تجاهل مكرر، أو قائمة أطول من السقف) والرد 200.
        //    الفشل العابر الوحيد — إرسال ما نجح — بيطلع كاستثناء وبيوصل
        //    catch تحت فبيصير "failed" و500، وهاد المطلوب بالضبط.
        // ---------------------------------------------------------------
        const conversation = await this.conversation.handleInbound(tx, {
          restaurantId,
          phoneNumberId: message.phoneNumberId,
          from: message.from,
          body: message.body,
          deferred,
        });
        logger.debug(
          { restaurantId, waMessageId: message.waMessageId, conversation },
          "خطوة المحادثة خلصت",
        );

        return "stored";
      });

      // ---------------------------------------------------------------
      // ٥. 🔴 **بعد الـCOMMIT.** رسالة «استلمنا طلبك» بتنبعت من هون وبس
      //    (ج §8، الخطوة 7): قبل الـCOMMIT بتخلّي الزبون ماسك تأكيدا عن
      //    طلب ممكن ما ينكتب، و**الرسالة ما بتنسحب** مع المعاملة.
      //    وفشلها بينسجّل وبس — الطلب مكتوب ومقفول وما بينمسّ.
      // ---------------------------------------------------------------
      await flushDeferred(this.conversation.sender, deferred);
      return outcome;
    } catch (error) {
      if (error instanceof UnroutableMessageError) {
        logger.error(
          {
            phoneNumberId: message.phoneNumberId,
            waMessageId: message.waMessageId,
          },
          "🔴 ما في مطعم فعّال على هالرقم — 500، والمطالبة انسحبت عشان إعادة الإرسال تنفع",
        );
        return "unroutable";
      }

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
