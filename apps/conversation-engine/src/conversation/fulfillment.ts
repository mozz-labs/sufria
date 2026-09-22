import {
  ADDRESS_ASK_AR,
  ADDRESS_TOO_LONG_AR,
  FULFILLMENT_PROMPT_AR,
  HANDOFF_STREAK,
  MAX_ADDRESS_LENGTH,
  ORDER_CANCELLED_AR,
  handoffMessageAr,
  matchCommand,
  matchOrderCommand,
  type Currency,
  type SummaryFulfillment,
} from "@sufria/shared";

import { advanceSessionState } from "../db/critical-primitives.js";
import { renderCart, renderSummary } from "./cart-view.js";
import type { TenantTx } from "../db/types.js";
import { logger } from "../logger.js";
import type { WhatsAppSender } from "../whatsapp/sender.js";
import {
  readSessionData,
  toSummaryFulfillment,
  writeSessionData,
  type Fulfillment,
  type SessionData,
} from "./session-data.js";

/**
 * رسالة من زبون جلسته بحالة `fulfillment_choice` — ج-3، صفوف §3.
 *
 * نفس شكل `browsing.ts`: قشرة رفيعة فيها كل الـI/O، وقرار صافٍ ما بيلمس
 * قاعدة ولا شبكة ولا ساعة.
 *
 * 🔴 **الحالة وحدة بالقاعدة، وخطوتان بالكود.** `conversation_state` ما فيه
 *    قيمة لخطوة العنوان، والخطوة بتنعرف من `SessionData.fulfillment`:
 *      - غائب                              ← خطوة النوع
 *      - `delivery` وعنوانه `null`         ← خطوة العنوان
 *    وهاد مقصود: قيمة enum جديدة بدها هجرة، والخطوتان مشتركتان بكل شي
 *    («عدّل» و«ألغِ» بيشتغلوا بالاتنتين)، فالفرق الوحيد بينهم سؤال واحد.
 */

// ---------------------------------------------------------------------------
// القرار — صافٍ
// ---------------------------------------------------------------------------

export interface FulfillmentDecision {
  readonly next: SessionData;
  readonly reply: string | null;
  /** CAS من `fulfillment_choice` للحالة هاي. `null` = بقاء بلا CAS (§3). */
  readonly advanceTo: "cart_review" | "browsing" | null;
}

export interface FulfillmentInput {
  readonly data: SessionData;
  /** نص الرسالة. `null` لصورة أو موقع أو صوت. */
  readonly body: string | null;
  readonly contactPhone: string | null;
  /** `restaurants.delivery_fee` بالقروش، **حيّة** — بتنعمل snapshot هون. */
  readonly deliveryFeeMinor: number;
  /** `restaurants.currency` — لكل نص فيه مبلغ (بريف د §2.2). */
  readonly currency: Currency;
}

/** كل رد صادر بينعدّ — فجوة القياس بـب §4. الصمت ما بينعدّ. */
function withReply(
  next: SessionData,
  reply: string | null,
  advanceTo: FulfillmentDecision["advanceTo"] = null,
): FulfillmentDecision {
  return reply === null
    ? { next, reply: null, advanceTo }
    : {
        next: { ...next, outbound_count: next.outbound_count + 1 },
        reply,
        advanceTo,
      };
}

/** الملخّص ← `cart_review`. */
function summaryDecision(
  data: SessionData,
  fulfillment: Fulfillment,
  summary: SummaryFulfillment,
  currency: Currency,
): FulfillmentDecision {
  const next = { ...data, fulfillment };
  return withReply(next, renderSummary(next, summary, currency), "cart_review");
}

/**
 * «عدّل» — **انتقال حالة حقيقي** لـ`browsing` بنفس السلّة (ج §2.3).
 * 🔴 و`fulfillment` بتنمسح هون بقصد: الزبون رجع يعدّل **قبل** ما يشوف
 *    الملخّص، يعني ما وافق على طريقة الاستلام، فبينسأل عنها من جديد.
 *    («عدّل» من `cart_review` بتخليها — ذاك صفّ تاني بـ§3، وهو ج-4.)
 */
function modifyDecision(
  data: SessionData,
  currency: Currency,
): FulfillmentDecision {
  const next = { ...data, fulfillment: undefined };
  return withReply(next, renderCart(next, currency), "browsing");
}

/**
 * «ألغِ» — سلّة فارغة ورجوع للتصفّح.
 * 🔴 **مش `abandoned`.** تلك للمهلة (Sprint 2). و`menu_map` بتضل صالحة،
 *    فرقم الصنف بيشتغل فورا بلا «منيو» — وهاد اللي بيوعد فيه نص الإلغاء.
 */
function cancelDecision(data: SessionData): FulfillmentDecision {
  return withReply(
    { ...data, cart: [], fulfillment: undefined },
    ORDER_CANCELLED_AR,
    "browsing",
  );
}

export function decideFulfillment(
  input: FulfillmentInput,
): FulfillmentDecision {
  const { data, body, contactPhone, deliveryFeeMinor, currency } = input;
  const command = matchOrderCommand(body ?? "");

  // «عدّل» و«ألغِ» بيشتغلوا **بالخطوتين** (§3، صفّا «أي خطوة»).
  if (command === "modify") return modifyDecision(data, currency);
  if (command === "cancel") return cancelDecision(data);

  const pending = data.fulfillment;
  const onAddressStep =
    pending !== undefined && pending.type === "delivery" && !pending.address;

  if (onAddressStep) {
    // خطوة العنوان. 🔴 **بلا عدّاد**: كل نص مش أمر هو عنوان، والملخّص
    //    بيعرضه قبل «أكّد» — وهاد بالضبط اللي بيخلّي §2.1 آمنة.
    if (command === "pickup") {
      // بدّل رأيه. الرسوم بتختفي معها — ما عاد إلها معنى.
      return summaryDecision(
        data,
        { type: "pickup" },
        { type: "pickup" },
        currency,
      );
    }
    // أي أمر تاني معروف: مش عنوان.
    //
    // 🔴 **المطابقان معا، مش `matchOrderCommand` وحده** (§3: «توصيل · تم ·
    //    سلة · منيو · أكّد»). «تم» و«سلة» و«منيو» أوامر **تصفّح**، فما
    //    بيعرفها مطابق أوامر الطلب أصلا — وبدون السطر التالي بتنخزن «منيو»
    //    كعنوان توصيل وبتطلع بالملخّص «التوصيل إلى: منيو»، والسائق بيوصل
    //    لحدا ما، **بلا ولا رسالة خطأ**. مسكها اختبار، مش قراءة.
    if (command !== null || matchCommand(body ?? "") !== null) {
      return withReply(data, ADDRESS_ASK_AR);
    }
    // رسالة بلا نص (موقع · صورة): المحرّك بيوصّلها هون بـ`body = null`
    // (فحص ج-0 #7). موقع واتساب مش مدعوم كعنوان — بينعاد الطلب نصا.
    if (body === null) return withReply(data, ADDRESS_ASK_AR);

    // 🔴 **قصّ الأطراف وبس. ولا تطبيع إطلاقا** — سائق بيقرأ هاد النص،
    //    و«ة»→«ه» بتغيّر اسم حي. التطبيع للمطابقة وحدها (ج §0).
    const address = body.trim();
    if (address.length === 0) return withReply(data, ADDRESS_ASK_AR);
    if (address.length > MAX_ADDRESS_LENGTH) {
      return withReply(data, ADDRESS_TOO_LONG_AR);
    }

    const delivery = { ...pending, address };
    const summary = toSummaryFulfillment(delivery);
    if (summary === null) return withReply(data, ADDRESS_ASK_AR);
    return summaryDecision(data, delivery, summary, currency);
  }

  // خطوة النوع.
  if (pending !== undefined) {
    // ثابت مكسور: طريقة استلام مكتملة والجلسة لسا `fulfillment_choice`.
    // ولا مسار بيوصّل لهون — بينسجّل وبينعاد السؤال، والحالة بتتعافى.
    logger.error(
      { fulfillment: pending },
      "fulfillment مكتملة وجلستها لسا fulfillment_choice — ثابت مكسور",
    );
  }

  if (command === "pickup") {
    return summaryDecision(
      { ...data, unparsed_streak: 0 },
      { type: "pickup" },
      { type: "pickup" },
      currency,
    );
  }

  if (command === "delivery") {
    // 🔴 **snapshot الرسوم هون، لحظة الاختيار.** الزبون شافها بالسؤال،
    //    فصارت وعدا. المطعم بيرفعها بعد شوي والطلب بيضل بالقديمة.
    return withReply(
      {
        ...data,
        unparsed_streak: 0,
        fulfillment: {
          type: "delivery",
          fee_minor: deliveryFeeMinor,
          address: null,
        },
      },
      ADDRESS_ASK_AR,
    );
  }

  // ولا مطابقة: العدّاد، بنفس قواعد `browsing` حرفيا (§3).
  const streak = data.unparsed_streak + 1;
  const next = { ...data, unparsed_streak: streak };
  if (data.handoff_sent) return withReply(next, null);
  if (streak >= HANDOFF_STREAK) {
    const handedOff = { ...next, handoff_sent: true };
    return withReply(
      handedOff,
      contactPhone === null ? null : handoffMessageAr(contactPhone),
    );
  }
  // 🔴 صرامة **مع** توجيه: كل إعادة سؤال بتقول حرفيا شو يكتب (ج §2.3).
  return withReply(next, FULFILLMENT_PROMPT_AR);
}

// ---------------------------------------------------------------------------
// القشرة — I/O
// ---------------------------------------------------------------------------

export interface FulfillmentMessage {
  readonly sessionId: string;
  readonly restaurantId: string;
  readonly phoneNumberId: string;
  readonly to: string;
  readonly body: string | null;
  readonly contactPhone: string | null;
  readonly deliveryFeeMinor: number;
  readonly currency: Currency;
  readonly now: Date;
}

/** نفس ترتيب `handleBrowsingMessage`: قفل، فقرار، فCAS، فكتابة، فإرسال. */
export async function handleFulfillmentMessage(
  tx: TenantTx,
  sender: WhatsAppSender,
  message: FulfillmentMessage,
): Promise<void> {
  const data = await readSessionData(tx, message.sessionId);

  const decision = decideFulfillment({
    data,
    body: message.body,
    contactPhone: message.contactPhone,
    deliveryFeeMinor: message.deliveryFeeMinor,
    currency: message.currency,
  });

  if (decision.advanceTo !== null) {
    if (
      !(await advanceSessionState(
        tx,
        message.sessionId,
        "fulfillment_choice",
        decision.advanceTo,
      ))
    ) {
      logger.debug(
        {
          restaurantId: message.restaurantId,
          sessionId: message.sessionId,
          target: decision.advanceTo,
        },
        "CAS خسر — الرسالة انعالجت مرة قبل هيك. تجاهل صامت",
      );
      return;
    }
  }

  await writeSessionData(tx, message.sessionId, decision.next, message.now);

  if (decision.reply !== null) {
    await sender.sendText({
      restaurantId: message.restaurantId,
      phoneNumberId: message.phoneNumberId,
      to: message.to,
      body: decision.reply,
    });
  }
}
