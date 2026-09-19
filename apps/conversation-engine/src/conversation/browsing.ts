import {
  FINISH_HINT_AR,
  HANDOFF_STREAK,
  MAX_QTY_PER_ITEM,
  cartMessageAr,
  handoffMessageAr,
  interpretMessage,
  itemNotInCartAr,
  itemUnavailableAr,
  itemsAddedLinesAr,
  nextUnparsedStreak,
  nothingUnderstoodAr,
  overCapLineAr,
  unclearPartsLineAr,
  unknownNumbersLineAr,
  type MessageIntent,
} from "@sufria/shared";

import type { TenantTx } from "../db/types.js";
import { logger } from "../logger.js";
import { readCatalog, type Catalog } from "../restaurant/catalog.js";
import type { WhatsAppSender } from "../whatsapp/sender.js";
import { deliverMenu, prepareMenu } from "./menu-delivery.js";
import {
  readSessionData,
  writeSessionData,
  type CartLine,
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
}

export interface BrowsingInput {
  readonly data: SessionData;
  readonly intent: MessageIntent;
  /** الأصناف اللي ذكرتها الرسالة، مقروءة حيّا لحظة المعالجة. */
  readonly catalog: Catalog;
  /** `restaurants.contact_phone`. `null` = الاستسلام صامت تماما (§11.3). */
  readonly contactPhone: string | null;
}

/** كل رد صادر بينعدّ — فجوة القياس بـ§4. الصمت ما بينعدّ. */
function withReply(next: SessionData, reply: string | null): BrowsingDecision {
  return reply === null
    ? { next, reply: null, resendMenu: false }
    : {
        next: { ...next, outbound_count: next.outbound_count + 1 },
        reply,
        resendMenu: false,
      };
}

/** مجموع السلّة **بالقروش** — أعداد صحيحة، بلا float بأي خطوة (§11.6-أ). */
export function cartTotalMinor(cart: readonly CartLine[]): number {
  return cart.reduce((sum, l) => sum + l.unit_price_minor * l.qty, 0);
}

/** عرض السلّة **برقم الخريطة الحالية** — مصدر ترقيم واحد (§12.1). */
function renderCart(data: SessionData): string {
  const numberOf = new Map<string, number>(
    Object.entries(data.menu_map).map(([n, id]) => [id, Number(n)]),
  );
  return cartMessageAr(
    data.cart.map((l) => ({
      menuNumber: numberOf.get(l.item_id) ?? null,
      name: l.name,
      qty: l.qty,
      lineTotalMinor: l.unit_price_minor * l.qty,
    })),
    cartTotalMinor(data.cart),
  );
}

export function decideBrowsing(input: BrowsingInput): BrowsingDecision {
  const { data, intent, catalog, contactPhone } = input;
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
          return { next, reply: null, resendMenu: true };
        case "cart":
          return withReply(next, renderCart(next));
        case "finish":
          // ب-5. هون: تصفير وبس، بلا رد (§14.7).
          return { next, reply: null, resendMenu: false };
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
      return withReply(removed, renderCart(removed));
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
        if (data.handoff_sent) return { next, reply: null, resendMenu: false };
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
        ...itemsAddedLinesAr(added, cartTotalMinor(cart)),
      ];
      if (unknownNumbers.length > 0) {
        lines.push(unknownNumbersLineAr(unknownNumbers, lastMenuNumber));
      }
      // ⚠️ ما في نص جمع لغير المتوفر — سطر لكل صنف (§14.8).
      for (const name of unavailable) lines.push(itemUnavailableAr(name));
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
  });

  await writeSessionData(tx, message.sessionId, decision.next, message.now);

  if (decision.resendMenu) {
    // «منيو»: نفس الطريق الوحيد لإرسال قائمة — الخريطة بتنستبدل كاملة معها.
    const prepared = await prepareMenu(tx, null);
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
    return;
  }

  if (decision.reply !== null) {
    await sender.sendText({
      restaurantId: message.restaurantId,
      phoneNumberId: message.phoneNumberId,
      to: message.to,
      body: decision.reply,
    });
  }
}
