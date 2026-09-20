import {
  CONFIRM_PROMPT_AR,
  HANDOFF_STREAK,
  ORDER_CANCELLED_AR,
  handoffMessageAr,
  matchOrderCommand,
} from "@sufria/shared";

import { advanceSessionState } from "../db/critical-primitives.js";
import type { TenantTx } from "../db/types.js";
import { logger } from "../logger.js";
import type { WhatsAppSender } from "../whatsapp/sender.js";
import { renderCart } from "./cart-view.js";
import {
  readSessionData,
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
    ? { next, reply: null, advanceTo }
    : {
        next: { ...next, outbound_count: next.outbound_count + 1 },
        reply,
        advanceTo,
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
     * ⛔ **ج-5 بتستبدل هالفرع كاملا** بترانزاكشن الإنشاء (§8).
     *    لهلأ بينعاد السؤال — بس **بيصفّر العدّاد** زي أي مطابقة تانية
     *    (§3): الزبون كتب كلمة صحيحة، فما بيصح يتقدّم خطوة نحو رسالة
     *    الاستسلام لأن الميزة لسا ما انبنت.
     */
    case "confirm":
      return withReply({ ...data, unparsed_streak: 0 }, CONFIRM_PROMPT_AR);

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
  readonly now: Date;
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
