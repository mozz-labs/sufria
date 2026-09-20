import {
  CART_EMPTY_AR,
  CONFIRM_PROMPT_AR,
  HANDOFF_STREAK,
  ORDER_CANCELLED_AR,
  ORDER_STATUS_MESSAGE_AR,
  fulfillmentAskAr,
  handoffMessageAr,
  itemsRemovedUnavailableLineAr,
  matchOrderCommand,
} from "@sufria/shared";

import { advanceSessionState } from "../db/critical-primitives.js";
import type { TenantTx } from "../db/types.js";
import { logger } from "../logger.js";
import type { WhatsAppSender } from "../whatsapp/sender.js";
import { renderCart, renderSummary } from "./cart-view.js";
import { checkAvailability, insertOrder } from "./order-creation.js";
import type { DeferredSend } from "./session.service.js";
import {
  readSessionData,
  toSummaryFulfillment,
  writeSessionData,
  type SessionData,
} from "./session-data.js";

/**
 * رسالة من زبون جلسته بحالة `cart_review` — ج-4، صفوف §3.
 *
 * الزبون شاف الملخّص كاملا: الأصناف والرسوم والمجموع والعنوان وطريقة الدفع.
 * تلات كلمات بتشتغل هون وبس: **أكّد · عدّل · ألغِ**.
 *
 * 🔴 **المحلّل صارم، والصرامة معها توجيه.** أي رسالة برّا القوائم بيتعاد
 *    فيها السؤال بنص بيقول حرفيا شو يكتب — صرامة بلا توجيه حلقة ما بتنتهي.
 *
 * ⛔ «أكّد» لسا ما بتخلق طلبا — هاي ج-5. شوف فرعها تحت.
 */

// ---------------------------------------------------------------------------
// القرار — صافٍ
// ---------------------------------------------------------------------------

export interface CartReviewDecision {
  readonly next: SessionData;
  readonly reply: string | null;
  /** CAS من `cart_review`. `null` = بقاء بلا CAS (§3). */
  readonly advanceTo: "browsing" | null;
  /** «أكّد»: القشرة بتمشي ترانزاكشن الإنشاء (§8). القرار الصافي ما بيلمسها. */
  readonly confirm: boolean;
}

export interface CartReviewInput {
  readonly data: SessionData;
  readonly body: string | null;
  readonly contactPhone: string | null;
}

/** كل رد صادر بينعدّ — فجوة القياس بـب §4. الصمت ما بينعدّ. */
function withReply(
  next: SessionData,
  reply: string | null,
  advanceTo: CartReviewDecision["advanceTo"] = null,
): CartReviewDecision {
  return reply === null
    ? { next, reply: null, advanceTo, confirm: false }
    : {
        next: { ...next, outbound_count: next.outbound_count + 1 },
        reply,
        advanceTo,
        confirm: false,
      };
}

export function decideCartReview(input: CartReviewInput): CartReviewDecision {
  const { data, contactPhone } = input;
  const command = matchOrderCommand(input.body ?? "");

  switch (command) {
    /**
     * 🔴 **«عدّل» انتقال حالة حقيقي**، مش إعادة عرض (§2.3): الجلسة بترجع
     *    `browsing` فأوامر التصفّح كلها بترجع تشتغل — «شيل 3» و«منيو» ورقم
     *    الصنف. والعرض **بذيل «شيل»**، لأنه هون بيشتغل فعلا.
     *
     * 🔴 **و`fulfillment` بيضل** — وهاد الفرق المقصود عن «عدّل» بخطوة
     *    `fulfillment_choice` (ج-3) اللي بتمسحه. السبب: هون الزبون شاف
     *    الملخّص كامل ووافق على طريقة الاستلام ضمنا بأنه بدّه يعدّل السلّة
     *    وبس. سؤاله عنها من جديد بيخلّيه يجاوب مرتين عن نفس الإشي.
     *    المسار الطبيعي: `cart_review ← عدّل ← browsing ← شيل 3 ← تم ←
     *    cart_review ← أكّد` — و«تم» التانية بتلاقي `fulfillment` مكتمل
     *    فبتفوت على الملخّص رأسا (ج §3، الصفّ التاني).
     */
    case "modify":
      return withReply(data, renderCart(data), "browsing");

    /**
     * «ألغِ» — سلّة فارغة ورجوع للتصفّح. **مش `abandoned`** (تلك للمهلة،
     * Sprint 2). و`menu_map` بتضل صالحة، فرقم الصنف بيشتغل فورا بلا «منيو»
     * — وهاد بالضبط اللي بيوعد فيه نص الإلغاء.
     */
    case "cancel":
      return withReply(
        { ...data, cart: [], fulfillment: undefined },
        ORDER_CANCELLED_AR,
        "browsing",
      );

    /**
     * 🔴 **اللحظة اللي بينخلق فيها الطلب** (§2.1). كل شي بعدها I/O —
     *    فحص توفّر حيّ، وCAS، وتلات كتابات، وإرسال بعد الـCOMMIT — فالقرار
     *    الصافي بيعلّم وبس، والقشرة بتمشي §8.
     */
    case "confirm":
      return {
        next: { ...data, unparsed_streak: 0 },
        reply: null,
        advanceTo: null,
        confirm: true,
      };

    /**
     * «استلام» و«توصيل» بيطابقوا `matchOrderCommand` بس ما إلهم معنى هون —
     * تغيير طريقة الاستلام بعد الملخّص بيصير عبر «ألغِ» وبس (ج §13).
     * بيتعاملوا كأي رسالة تانية: إعادة السؤال. وبيصفّروا العدّاد لأنهم
     * مطابقة — القاعدة «بيصفّر على **أي** مطابقة».
     */
    case "pickup":
    case "delivery":
      return withReply({ ...data, unparsed_streak: 0 }, CONFIRM_PROMPT_AR);

    case null:
      break;

    default: {
      const unhandled: never = command;
      return unhandled;
    }
  }

  // ولا مطابقة — منها «تم» و«لا» و«تمام» (§3). العدّاد بنفس قواعد
  // `browsing` حرفيا: بيرتفع على غير المطابق، وعند 3 رسالة الاستسلام مرة.
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
  return withReply(next, CONFIRM_PROMPT_AR);
}

// ---------------------------------------------------------------------------
// القشرة — I/O
// ---------------------------------------------------------------------------

export interface CartReviewMessage {
  readonly sessionId: string;
  readonly restaurantId: string;
  readonly phoneNumberId: string;
  readonly to: string;
  readonly body: string | null;
  readonly contactPhone: string | null;
  /** حيّة — بتلزم لو انكسر الثابت ورجعنا نسأل عن طريقة الاستلام (§8، خطوة 0). */
  readonly deliveryFeeMinor: number;
  /** طابور ما بعد الـCOMMIT. «استلمنا طلبك» بتتحط هون، ما بتنبعت هون. */
  readonly deferred: DeferredSend[];
  readonly now: Date;
}

/** أكتر من رسالة بالترتيب — كلها انعدّت بالكتابة اللي قبلها. */
async function sendAll(
  sender: WhatsAppSender,
  message: CartReviewMessage,
  bodies: readonly string[],
): Promise<void> {
  for (const body of bodies) {
    await sender.sendText({
      restaurantId: message.restaurantId,
      phoneNumberId: message.phoneNumberId,
      to: message.to,
      body,
    });
  }
}

/**
 * «أكّد» — ترانزاكشن الإنشاء، §8 بخطواتها.
 *
 * بترجّع `true` لو خلصت الرسالة هون، و`false` لو لازم المسار العادي يكمّل.
 */
async function handleConfirm(
  tx: TenantTx,
  sender: WhatsAppSender,
  message: CartReviewMessage,
  data: SessionData,
): Promise<void> {
  // --- الخطوة 0: الثابت ------------------------------------------------------
  const fulfillment = toSummaryFulfillment(data.fulfillment);
  if (fulfillment === null) {
    // ولا مسار بيوصّل لهون. بينسجّل، وبينرجع السؤال، والحالة بتتعافى.
    logger.error(
      { restaurantId: message.restaurantId, sessionId: message.sessionId },
      "🔴 «أكّد» وطريقة الاستلام ناقصة — ثابت مكسور. رجوع لسؤال الاستلام",
    );
    if (
      !(await advanceSessionState(
        tx,
        message.sessionId,
        "cart_review",
        "fulfillment_choice",
      ))
    ) {
      return;
    }
    const ask = fulfillmentAskAr(message.deliveryFeeMinor);
    await writeSessionData(
      tx,
      message.sessionId,
      {
        ...data,
        fulfillment: undefined,
        outbound_count: data.outbound_count + 1,
      },
      message.now,
    );
    await sendAll(sender, message, [ask]);
    return;
  }

  // --- الخطوة 1: فحص توفّر حيّ ------------------------------------------------
  const availability = await checkAvailability(tx, data);
  if (availability.kind !== "all-available") {
    // 🔴 **لا طلب.** صنف ما عاد متوفر بين الملخّص و«أكّد» ما بيوصل المطبخ.
    const removedLine = itemsRemovedUnavailableLineAr([
      ...availability.removed,
    ]);

    if (availability.kind === "emptied") {
      const next = {
        ...data,
        cart: [],
        outbound_count: data.outbound_count + 2,
      };
      if (
        !(await advanceSessionState(
          tx,
          message.sessionId,
          "cart_review",
          "browsing",
        ))
      ) {
        return;
      }
      await writeSessionData(tx, message.sessionId, next, message.now);
      await sendAll(sender, message, [removedLine, CART_EMPTY_AR]);
      return;
    }

    // بقي شي: السلّة المقلَّمة، وسطر الحذف، والملخّص من جديد — والبقاء
    // بـ`cart_review`. FR-07: الزبون بيعيد التأكيد على اللي صار فعلا.
    const next = {
      ...data,
      cart: [...availability.cart],
      outbound_count: data.outbound_count + 2,
    };
    await writeSessionData(tx, message.sessionId, next, message.now);
    await sendAll(sender, message, [
      removedLine,
      renderSummary(next, fulfillment),
    ]);
    return;
  }

  // --- الخطوة 2: CAS ---------------------------------------------------------
  // 🔴 **قبل أي كتابة.** «أكّد» مرتين بمعرّفين مختلفين = رسالتان شرعيتان،
  //    وطبقة `event_id` بتمرّق الاتنتين بالتصميم. هاي اللي بتخلّي الطلب واحدا.
  if (
    !(await advanceSessionState(
      tx,
      message.sessionId,
      "cart_review",
      "order_placed",
    ))
  ) {
    logger.debug(
      { restaurantId: message.restaurantId, sessionId: message.sessionId },
      "CAS خسر — «أكّد» انعالجت مرة قبل هيك. تجاهل صامت، ولا شي انكتب",
    );
    return;
  }

  // --- الخطوات 3 إلى 5 -------------------------------------------------------
  const created = await insertOrder(tx, {
    sessionId: message.sessionId,
    restaurantId: message.restaurantId,
    data,
    fulfillment,
  });

  // --- الخطوة 6 --------------------------------------------------------------
  await writeSessionData(
    tx,
    message.sessionId,
    {
      ...data,
      order_id: created.orderId,
      outbound_count: created.outboundCount,
    },
    message.now,
  );

  // --- الخطوة 7: بعد الـCOMMIT ------------------------------------------------
  // 🔴 بتتحط بالطابور وبس. مالك المعاملة بيبعتها بعد ما تنجح.
  message.deferred.push({
    restaurantId: message.restaurantId,
    phoneNumberId: message.phoneNumberId,
    to: message.to,
    body: ORDER_STATUS_MESSAGE_AR.pending_acceptance,
  });

  logger.info(
    {
      restaurantId: message.restaurantId,
      orderId: created.orderId,
      fulfillment: fulfillment.type,
    },
    "طلب انخلق",
  );
}

/** نفس ترتيب `handleBrowsingMessage`: قفل، فقرار، فCAS، فكتابة، فإرسال. */
export async function handleCartReviewMessage(
  tx: TenantTx,
  sender: WhatsAppSender,
  message: CartReviewMessage,
): Promise<void> {
  const data = await readSessionData(tx, message.sessionId);

  const decision = decideCartReview({
    data,
    body: message.body,
    contactPhone: message.contactPhone,
  });

  if (decision.confirm) {
    await handleConfirm(tx, sender, message, decision.next);
    return;
  }

  if (decision.advanceTo !== null) {
    if (
      !(await advanceSessionState(
        tx,
        message.sessionId,
        "cart_review",
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
