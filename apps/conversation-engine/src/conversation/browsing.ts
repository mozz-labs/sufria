import {
  CART_EMPTY_ON_FINISH_AR,
  FINISH_HINT_AR,
  fulfillmentAskAr,
  type SummaryFulfillment,
  HANDOFF_STREAK,
  MAX_QTY_PER_ITEM,
  handoffMessageAr,
  interpretMessage,
  itemNotInCartAr,
  itemsAddedLinesAr,
  itemsUnavailableLineAr,
  nextUnparsedStreak,
  nothingUnderstoodAr,
  overCapLineAr,
  unclearPartsLineAr,
  unknownNumbersLineAr,
  type Currency,
  type MessageIntent,
} from "@sufria/shared";

import type { TenantTx } from "../db/types.js";
import { logger } from "../logger.js";
import { readCatalog, type Catalog } from "../restaurant/catalog.js";
import type { WhatsAppSender } from "../whatsapp/sender.js";
import { advanceSessionState } from "../db/critical-primitives.js";
import { cartTotalMinor, renderCart, renderSummary } from "./cart-view.js";
import { deliverMenu, prepareMenu } from "./menu-delivery.js";
import { replyOrdersPaused } from "./orders-paused.js";
import {
  readSessionData,
  toSummaryFulfillment,
  writeSessionData,
  type SessionData,
} from "./session-data.js";

/**
 * رسالة من زبون جلسته بحالة `browsing` — ب-4.
 *
 * الشكل: قشرة رفيعة فيها كل الـI/O، وقرار صافٍ بالنص (`decideBrowsing`) ما
 * بيلمس قاعدة ولا شبكة. القرار بياخد الحالة ويرجّع الحالة الجاية والرد.
 *
 * ⛔ «تم» مش هون — ب-5. هون بيصفّر العدّاد وبس، بلا رد (§14.7).
 */

// ---------------------------------------------------------------------------
// القرار — صافٍ
// ---------------------------------------------------------------------------

export interface BrowsingDecision {
  readonly next: SessionData;
  /** الرد النصي، أو `null` = صمت. */
  readonly reply: string | null;
  /** «منيو»: القشرة بتعيد إرسال القائمة عبر `deliverMenu` — والخريطة معها. */
  readonly resendMenu: boolean;
  /**
   * «تم» وسلّة فيها أصناف: القشرة بتعمل CAS من `browsing` للحالة هاي **قبل**
   * ما تكتب وتبعت. خسارة الـCAS = تجاهل صامت (ب-5). `null` = ولا انتقال.
   *
   * 🔴 صارت حالة بدل `boolean` بج-3: «تم» ما عادت بتوصّل لمكان واحد. المطعم
   *    اللي بيوصّل بيوقّف الزبون عند سؤال الاستلام (`fulfillment_choice`)،
   *    واللي ما بيوصّل بيفوت على الملخّص رأسا (`cart_review`) — ج §3.
   */
  readonly advanceTo: "cart_review" | "fulfillment_choice" | null;
}

export interface BrowsingInput {
  readonly data: SessionData;
  readonly intent: MessageIntent;
  /** الأصناف اللي ذكرتها الرسالة، مقروءة حيّا لحظة المعالجة. */
  readonly catalog: Catalog;
  /** `restaurants.contact_phone`. `null` = الاستسلام صامت تماما (§11.3). */
  readonly contactPhone: string | null;
  /**
   * `restaurants.offers_delivery` — **قدرة المطعم، مش اختيار الطلب** (ج §2.4).
   * 🔴 بينقرا **حيّا لحظة «تم»** (ج §3)، مش من الجلسة: مطعم طفّى التوصيل
   *    بينطبّق عليه القرار من أول «تم» جاية، بلا ما تنتظر جلسة جديدة.
   */
  readonly offersDelivery: boolean;
  /** `restaurants.delivery_fee` بالقروش — بينعمله snapshot عند اختيار «توصيل». */
  readonly deliveryFeeMinor: number;
  /** `restaurants.currency` — لكل نص فيه مبلغ (بريف د §2.2). */
  readonly currency: Currency;
}

/** كل رد صادر بينعدّ — فجوة القياس بـ§4. الصمت ما بينعدّ. */
function withReply(
  next: SessionData,
  reply: string | null,
  advanceTo: BrowsingDecision["advanceTo"] = null,
): BrowsingDecision {
  return reply === null
    ? { next, reply: null, resendMenu: false, advanceTo }
    : {
        next: { ...next, outbound_count: next.outbound_count + 1 },
        reply,
        resendMenu: false,
        advanceTo,
      };
}

export function decideBrowsing(input: BrowsingInput): BrowsingDecision {
  const { data, intent, catalog, contactPhone, offersDelivery } = input;
  const { deliveryFeeMinor, currency } = input;

  /** الملخّص ← `cart_review`. */
  const summaryDecision = (
    next: SessionData,
    fulfillment: SummaryFulfillment,
  ): BrowsingDecision =>
    withReply(next, renderSummary(next, fulfillment, currency), "cart_review");

  /** `N` = عدد مفاتيح `menu_map` — لا عدد الأصناف بالقاعدة (§4). */
  const lastMenuNumber = Object.keys(data.menu_map).length;

  switch (intent.kind) {
    // -----------------------------------------------------------------------
    // الأوامر — كلها بتصفّر العدّاد: «أي نجاح — … أو أمر معروف» (§4)
    // -----------------------------------------------------------------------
    case "command": {
      const next = { ...data, unparsed_streak: 0 };
      switch (intent.command) {
        case "menu":
          return { next, reply: null, resendMenu: true, advanceTo: null };
        case "cart":
          return withReply(next, renderCart(next, currency));
        case "finish": {
          // 🔴 سلّة فارغة: **ولا انتقال ولا CAS**، رسالة وبس، والجلسة بتضل
          //    `browsing` — فالزبون بيقدر يبلّش طلبه من نفس المكان (ب-5).
          if (next.cart.length === 0) {
            return withReply(next, CART_EMPTY_ON_FINISH_AR);
          }

          // الصفوف الأربعة الأولى من ج §3، بنفس ترتيبها:

          // ١. طريقة الاستلام مختارة وكاملة — رجع من «عدّل» مثلا. ولا سؤال
          //    تاني عن إشي انسأل عنه، والملخّص رأسا.
          const chosen = toSummaryFulfillment(next.fulfillment);
          if (chosen !== null) return summaryDecision(next, chosen);

          // ٢. المطعم ما بيوصّل: الاستلام هو الخيار الوحيد، فما بينسأل عنه.
          //    مطعم «توصيل فقط» مش مدعوم بالبايلوت — انحراف مسجّل (ج §2.4).
          if (!offersDelivery) {
            return summaryDecision(
              { ...next, fulfillment: { type: "pickup" } },
              { type: "pickup" },
            );
          }

          // ٣. بيوصّل وما في اختيار بعد: السؤال، والرسوم بتنقال قبل ما يقرر.
          //    🔴 ولا snapshot هون — الرسوم بتنحفظ لحظة ما يختار «توصيل»
          //    فعلا، مش لحظة ما بنسأله. لو اختار «استلام» ما إلها معنى أصلا.
          return withReply(
            next,
            fulfillmentAskAr(deliveryFeeMinor, currency),
            "fulfillment_choice",
          );
        }
        default: {
          const unhandled: never = intent.command;
          return unhandled;
        }
      }
    }

    // -----------------------------------------------------------------------
    // «شيل <رقم>» — §12 و§14.3
    // -----------------------------------------------------------------------
    case "remove": {
      const next = { ...data, unparsed_streak: 0 };
      const itemId = data.menu_map[String(intent.number)];
      if (itemId === undefined) {
        return withReply(
          next,
          unknownNumbersLineAr([intent.number], lastMenuNumber),
        );
      }
      if (!next.cart.some((l) => l.item_id === itemId)) {
        // 🔴 سطر لحاله، **بلا إعادة السلّة**: السلّة ما تغيّرت، وعرضها بيقول
        //    للزبون إن إشي صار.
        const entry = catalog.get(itemId);
        return withReply(
          next,
          entry === undefined
            ? unknownNumbersLineAr([intent.number], lastMenuNumber)
            : itemNotInCartAr(entry.name),
        );
      }
      // السطر كامل، لا وحدة من الكمية (§12.3-ج).
      const removed = {
        ...next,
        cart: next.cart.filter((l) => l.item_id !== itemId),
      };
      return withReply(removed, renderCart(removed, currency));
    }

    // -----------------------------------------------------------------------
    // أصناف
    // -----------------------------------------------------------------------
    case "items": {
      const result = intent.result;
      const streak = nextUnparsedStreak(data.unparsed_streak, result.outcome);

      if (result.outcome === "unparsed") {
        const next = { ...data, unparsed_streak: streak };
        // 🔴 بعد الاستسلام: صمت على غير المفهوم **وحده** (§14.7). رقم صحيح
        //    بعدها بيمرق من فرع الأصناف تحت ويتخدم عاديا.
        if (data.handoff_sent) return withReply(next, null);
        if (streak >= HANDOFF_STREAK) {
          // مرة وحدة بالجلسة. والرقم NULL = صمت تام، لا نص بديل (§11.3).
          const handedOff = { ...next, handoff_sent: true };
          return withReply(
            handedOff,
            contactPhone === null ? null : handoffMessageAr(contactPhone),
          );
        }
        return withReply(next, nothingUnderstoodAr(lastMenuNumber));
      }

      // parsed · partial — تعرّفنا على صنف حقيقي، فالعدّاد صفر (§13.3).
      const cart = [...data.cart];
      const added: { name: string; qty: number }[] = [];
      const unknownNumbers = [...result.problems.unknownNumbers];
      const unavailable: string[] = [];
      const overCap = result.problems.overCapItems.map((o) => o.requestedQty);

      for (const item of result.items) {
        const entry = catalog.get(item.itemId);
        if (entry === undefined) {
          // الصف انمسح كليا — ما في اسم نقول عنه «غير متوفر».
          unknownNumbers.push(item.number);
          continue;
        }
        if (!entry.available) {
          unavailable.push(entry.name);
          continue;
        }
        const at = cart.findIndex((l) => l.item_id === item.itemId);
        const existing = at === -1 ? undefined : cart[at];
        const total = (existing?.qty ?? 0) + item.qty;
        // 🔴 السقف على **السلّة**، لا على الرسالة وحدها (§14.7): «2 ×30» ثم
        //    «2 ×30» = 60. الرقم اللي بينقال هو المجموع المرفوض فعلا (§13.1).
        if (total > MAX_QTY_PER_ITEM) {
          overCap.push(total);
          continue;
        }
        if (existing === undefined) {
          // السعر والاسم snapshot لحظة الإضافة — وعد للزبون (§14.5).
          cart.push({
            item_id: item.itemId,
            name: entry.name,
            unit_price_minor: entry.unitPriceMinor,
            qty: item.qty,
          });
          added.push({ name: entry.name, qty: item.qty });
        } else {
          // سطر موجود: الكمية بتزيد، والـsnapshot الأول بيضل — سطر واحد لكل
          // صنف بسعر واحد (§7).
          cart[at] = { ...existing, qty: total };
          added.push({ name: existing.name, qty: item.qty });
        }
      }

      // 🔴 الترتيب ثابت (§14.1-1): النجاح أولا، ثم المشاكل. سطر لكل نوع.
      const lines: string[] = [
        ...itemsAddedLinesAr(added, cartTotalMinor(cart), currency),
      ];
      if (unknownNumbers.length > 0) {
        lines.push(unknownNumbersLineAr(unknownNumbers, lastMenuNumber));
      }
      // سطر واحد لكل غير المتوفر — نص الجمع وصل، ففجوة §14.8#1 انسدّت.
      if (unavailable.length > 0) {
        lines.push(itemsUnavailableLineAr(unavailable));
      }
      if (overCap.length > 0) lines.push(overCapLineAr(overCap));
      if (result.problems.unclearParts.length > 0) {
        lines.push(unclearPartsLineAr(result.problems.unclearParts));
      }

      // تذكير «تم» على تأكيد الصنف الأول وحده — مرة بالجلسة كلها (§2).
      let finishHintSent = data.finish_hint_sent;
      if (added.length > 0 && !finishHintSent) {
        lines.push(FINISH_HINT_AR);
        finishHintSent = true;
      }

      const next: SessionData = {
        ...data,
        cart,
        unparsed_streak: streak,
        finish_hint_sent: finishHintSent,
      };
      return withReply(next, lines.length > 0 ? lines.join("\n") : null);
    }

    default: {
      const unhandled: never = intent;
      return unhandled;
    }
  }
}

// ---------------------------------------------------------------------------
// القشرة — I/O
// ---------------------------------------------------------------------------

/** المعرّفات اللي بيحتاجها القرار من الكتالوج — ولا غيرها. */
function itemIdsNeeded(intent: MessageIntent, data: SessionData): string[] {
  if (intent.kind === "items") return intent.result.items.map((i) => i.itemId);
  if (intent.kind === "remove") {
    const id = data.menu_map[String(intent.number)];
    return id === undefined ? [] : [id];
  }
  return [];
}

export interface BrowsingMessage {
  readonly sessionId: string;
  readonly restaurantId: string;
  readonly phoneNumberId: string;
  readonly to: string;
  /** نص الرسالة. `null` لصورة أو صوت — بيتعامل كرسالة ما انفهم منها شي. */
  readonly body: string | null;
  readonly contactPhone: string | null;
  readonly offersDelivery: boolean;
  readonly deliveryFeeMinor: number;
  readonly currency: Currency;
  readonly now: Date;
}

/**
 * 🔴 **القفل أول شي بيلمس صف الجلسة.** `readSessionData` = `SELECT … FOR UPDATE`،
 *    وقبلها ولا `UPDATE` على الصف — ولا حتى `last_message_at`، اللي بينكتب
 *    **مع** `context` بنفس الكتابة. تحديث قبل القراءة كان بياخد القفل بالصدفة،
 *    فبيسلسل الرسائل المتزامنة بالترتيب بدل القفل — وقاعدة §14.1-3 صريحة:
 *    **القفل هو ما يمنعها، لا الترتيب.**
 *
 * 🔴 **ولا منع تكرار هون** (§14.1-4). رسالتان متطابقتان بمعرّفين مختلفين
 *    طلبان حقيقيان: زبون كتب «2» مرتين بدّه صنفين. الطبقة الأولى على
 *    `event_id` وكفى. بيبان كعطل وهو السلوك الصحيح — لا «تصلحه».
 *
 * الكتابة **قبل** الإرسال، زي `deliverMenu`: الإرسال أثر ما بينسحب، فلو فشلت
 * الكتابة بعده بيصير الزبون ماسك ردا عن سلّة ما انحفظت.
 */
export async function handleBrowsingMessage(
  tx: TenantTx,
  sender: WhatsAppSender,
  message: BrowsingMessage,
): Promise<void> {
  const data = await readSessionData(tx, message.sessionId);
  const intent = interpretMessage(message.body ?? "", data.menu_map);
  const catalog = await readCatalog(tx, itemIdsNeeded(intent, data));

  const decision = decideBrowsing({
    data,
    intent,
    catalog,
    contactPhone: message.contactPhone,
    offersDelivery: message.offersDelivery,
    deliveryFeeMinor: message.deliveryFeeMinor,
    currency: message.currency,
  });

  if (decision.resendMenu) {
    // «منيو» moves no state: `decideBrowsing` never pairs it with advanceTo.
    await resendMenu(tx, sender, message, decision.next);
    return;
  }

  if (decision.advanceTo !== null) {
    // 🔴 CAS ذري من `browsing`. `rowcount = 0` = حدا تاني سبقنا («تم» مرتين
    //    بنفس اللحظة) → **تجاهل بصمت، لا استثناء**، وبلا كتابة وبلا إرسال:
    //    ولا انتقال تاني، ولا عدّ رسالة صادرة ما انبعثت.
    if (
      !(await advanceSessionState(
        tx,
        message.sessionId,
        "browsing",
        decision.advanceTo,
      ))
    ) {
      logger.debug(
        {
          restaurantId: message.restaurantId,
          sessionId: message.sessionId,
          target: decision.advanceTo,
        },
        "CAS خسر — «تم» انعالجت مرة قبل هيك. تجاهل صامت",
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

/**
 * «منيو»: نفس الطريق الوحيد لإرسال قائمة — الخريطة بتنستبدل كاملة معها.
 *
 * 🔴 Prepared BEFORE the session is written (brief ي-أ §4, step 3): a menu
 *    with no item to show is not sent — the paused text goes instead, and
 *    then the session must stay exactly as it was, its streak and
 *    `last_message_at` included. Otherwise the order is the one it always
 *    was: the write, then the menu (or the error line, when it is too long).
 */
async function resendMenu(
  tx: TenantTx,
  sender: WhatsAppSender,
  message: BrowsingMessage,
  next: SessionData,
): Promise<void> {
  const prepared = await prepareMenu(tx, null, message.currency);

  if (!prepared.ok && prepared.reason === "empty") {
    await replyOrdersPaused(sender, message, "empty_menu");
    return;
  }

  await writeSessionData(tx, message.sessionId, next, message.now);

  if (!prepared.ok) {
    logger.error(
      {
        restaurantId: message.restaurantId,
        chars: prepared.error.length,
        limit: prepared.error.limit,
      },
      "🔴 «منيو»: القائمة أطول من سقف واتساب — ما انبعثت وما انقطعت",
    );
    return;
  }
  await deliverMenu(tx, sender, {
    sessionId: message.sessionId,
    restaurantId: message.restaurantId,
    phoneNumberId: message.phoneNumberId,
    to: message.to,
    menu: prepared.menu,
    now: message.now,
  });
}
