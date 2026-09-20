import { eq } from "drizzle-orm";
import { conversationSessions } from "@sufria/shared";
import { z } from "zod";

import type { TenantTx } from "../db/types.js";
import { logger } from "../logger.js";

/**
 * شكل `conversation_sessions.context` — عقد بريف السلّة §4.
 *
 * 🔴 **الاسم `SessionData` لا `Context`.** `ConversationContext` بـ
 *    `session.service.ts` اسم مأخوذ لشي تاني تماما (سياق الاستدعاء: المطعم
 *    ورقم ميتا ورقم الزبون). الخلط بينهم فخ مسجّل — §11.6-ب.
 *    العمود بالقاعدة بيضل اسمه `context`؛ الشكل بالكود اسمه `SessionData`.
 *
 * 🔴 **ولا حالة بالذاكرة.** كل ما بتعرفه المحادثة بيسكن هون، بصف الجلسة.
 *    عملية بتتعاد أو نسخة تانية بتشتغل بتلاقي نفس الحقيقة.
 */

/** سطر سلّة. `unit_price_minor` **قروش، عدد صحيح** — §11.6-أ. */
const cartLineSchema = z.object({
  item_id: z.string().uuid(),
  name: z.string(),
  /**
   * 🔴 قروش، لا دنانير عشرية. `numeric(12,2)` بترجع سترنغ، و
   * `Math.round(parseFloat("6.30") * 100)` بتعطي `630` بالضبط. الجمع كله
   * أعداد صحيحة، والقسمة على 100 عند العرض وبس. بلا float بأي خطوة —
   * وإلا `6.30 × 2` بتطلع `12.599999999999998` بسلّة زبون.
   */
  unit_price_minor: z.number().int().nonnegative(),
  qty: z.number().int().positive(),
});

export type CartLine = z.infer<typeof cartLineSchema>;

const sessionDataSchema = z.object({
  /**
   * 🔴 الترقيم **موضعي داخل القائمة المُرسَلة**، لا معرّفات قاعدة.
   *    بدونه: المطعم بيخفي صنفا وسط المحادثة، فرقم `4` عند الزبون بيشير لصنف
   *    تاني — والطلب بيوصل المطبخ غلط بلا ولا رسالة خطأ.
   *    و`N` برسائل الخطأ = `Object.keys(menu_map).length`، مش عدد الأصناف بالقاعدة.
   */
  menu_map: z.record(z.string(), z.string().uuid()).default({}),
  menu_sent_at: z.string().nullable().default(null),
  cart: z.array(cartLineSchema).default([]),
  /** بيزيد بس على رسالة ما انفهم منها ولا إشي، وبينصفّر على **أي** نجاح. */
  unparsed_streak: z.number().int().nonnegative().default(0),
  handoff_sent: z.boolean().default(false),
  finish_hint_sent: z.boolean().default(false),
  /**
   * ⚠️ فجوة قياس مقصود سدّها: `orders.outbound_msg_count` هو مدخل تسعير
   * الاشتراك، بس رسائل ما قبل إنشاء الطلب ما بتنعدّ عليه — الطلب لسا ما انخلق.
   * بتنعدّ هون، وبتنتقل لهناك عند الإنشاء (النقل بمهمة إنشاء الطلب، مش هون).
   */
  outbound_count: z.number().int().nonnegative().default(0),
});

export type SessionData = z.infer<typeof sessionDataSchema>;

/** جلسة جديدة: كل الحقول على قيمها الافتراضية. */
export const EMPTY_SESSION_DATA: SessionData = sessionDataSchema.parse({});

/**
 * 🔴 **بتقفل الصف: `SELECT … FOR UPDATE`.**
 *
 *    رسالتان بتوصلا بنفس اللحظة بتقرآ نفس `context` وبتكتبا فوق بعض —
 *    **الإضافة الأولى بتختفي بلا خطأ.** طبقة منع التكرار ما بتمسك هاد: معرّفا
 *    الرسالتين مختلفان بحق، فالاتنتان شرعيتان. القفل هو الشي الوحيد اللي
 *    بيسلسلهم.
 *
 *    والقفل بيتحرّر بنهاية معاملة الرسالة، فبيلزم إنها تكون هي المعاملة اللي
 *    بتكتب كمان — قراءة بمعاملة وكتابة بغيرها ما بتحمي ولا إشي.
 */
export async function readSessionData(
  tx: TenantTx,
  sessionId: string,
): Promise<SessionData> {
  const [row] = await tx
    .select({ context: conversationSessions.context })
    .from(conversationSessions)
    .where(eq(conversationSessions.id, sessionId))
    .for("update");

  if (row === undefined) {
    throw new Error(
      `صف الجلسة ${sessionId} غير مقروء — سياق المستأجر مش مضبوط`,
    );
  }

  const parsed = sessionDataSchema.safeParse(row.context);
  if (parsed.success) return parsed.data;

  // 🔴 `context` مشوّه = رجوع للقيم الافتراضية + سطر خطأ. **مش رمي استثناء.**
  //    نفس منطق `business_hours` المشوّه بيقرأ "مفتوح": الاستثناء بيسحب
  //    المعاملة، فميتا بتعيد الرسالة **سبعة أيام** على عطل الإعادة ما بتصلّحه،
  //    والزبون بيصير بصمت نهائي. السلّة بتفضى وهاد ظاهر للزبون وبيقدر يعيد،
  //    والصمت النهائي مش ظاهر لحدا.
  logger.error(
    { sessionId, issues: parsed.error.issues },
    "🔴 context مشوّه — رجوع للقيم الافتراضية. السلّة انفقدت",
  );
  return { ...EMPTY_SESSION_DATA };
}

/**
 * بتكتب الشكل كاملا. ما بتقفل — المفروض `readSessionData` قفلت قبلها.
 *
 * 🔴 **اقرأ (مقفولا) · عدّل · اكتب — بمعاملة الرسالة نفسها.** أي مسار
 *    بيقرأ بلا `readSessionData` أو بيكتب بمعاملة تانية بيفتح سباق «الإضافة
 *    الأولى بتختفي». القفل بيتحرّر بنهاية المعاملة، فقراءة بمعاملة
 *    وكتابة بغيرها ما بتحمي ولا إشي.
 *
 * `touchedAt` بيحدّث `last_message_at` **بنفس الكتابة**. مسار التصفّح بيمرّره
 * بدل تحديث منفصل قبل القراءة: أي `UPDATE` على صف الجلسة قبل
 * `readSessionData` بياخد قفل الصف **بالصدفة**، فبيسلسل الرسائل المتزامنة
 * بدل `FOR UPDATE` — والاختبار اللي بيشيل `FOR UPDATE` بيضل أخضر لسبب غلط.
 */
export async function writeSessionData(
  tx: TenantTx,
  sessionId: string,
  data: SessionData,
  touchedAt?: Date,
): Promise<void> {
  await tx
    .update(conversationSessions)
    .set(
      touchedAt === undefined
        ? { context: data }
        : { context: data, lastMessageAt: touchedAt },
    )
    .where(eq(conversationSessions.id, sessionId));
}
