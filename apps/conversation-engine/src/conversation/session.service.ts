import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import {
  closedMessageAr,
  conversationSessions,
  customers,
  priceToMinor,
  restaurants,
  type Currency,
} from "@sufria/shared";

import { env } from "../config/env.js";
import { advanceSessionState } from "../db/critical-primitives.js";
import type { TenantTx } from "../db/types.js";
import { logger, maskPhone } from "../logger.js";
import {
  decideHours,
  legacyTimezoneKey,
} from "../restaurant/business-hours.js";
import type { WhatsAppSender } from "../whatsapp/sender.js";
import { handleBrowsingMessage } from "./browsing.js";
import { handleCartReviewMessage } from "./cart-review.js";
import { handleFulfillmentMessage } from "./fulfillment.js";
import { deliverMenu, prepareMenu } from "./menu-delivery.js";
import { replyOrdersPaused } from "./orders-paused.js";
import { findReorderSource } from "./reorder.js";
import { isSessionExpired } from "./session-idle.js";

/**
 * المحادثة: بوابة ساعات الدوام، فتح الجلسة، أول رد — والتصفّح والسلّة (ب-4).
 *
 * جلسة بحالة `browsing` بتروح لـ`browsing.ts`: إضافة، عرض، حذف، «منيو»،
 * والعدّاد. باقي الحالات (`cart_review` وما بعدها) لسا بتتحدّث
 * `last_message_at` وبس — مهام جاية.
 *
 * ⛔ ولا عنوان، ولا دفع، ولا إنشاء طلب. و«تم» ب-5.
 *
 * جلسة نشطة سكتت `SESSION_IDLE_MINUTES` أو أكتر بتصير `abandoned` عند أول
 * رسالة بعدها، والرسالة بتمشي بمسار الجلسة الجديدة — بريف ح.
 *
 * Orders paused (`restaurants.orders_paused_at`, brief ي-أ §4): every message
 * gets ORDERS_PAUSED_AR — an active session's right after the timeout, before
 * any routing; a new conversation's right after the hours gate — and nothing
 * is written. A menu with no item to show gets the same text, instead of an
 * empty menu.
 */

/** الحالات اللي معناها "الجلسة خلصت". نفس تعريف 0002 و0007 بالضبط. */
const CLOSED_STATES = ["order_placed", "abandoned"] as const;

/** جلسة نشطة كما انقرأت قبل أي قفل — مع سكوتها محسوبا بساعة القاعدة. */
interface ActiveSession {
  id: string;
  state: (typeof conversationSessions.$inferSelect)["state"];
  /** `now() - last_message_at` بالثواني، من القاعدة (بريف ح §0). */
  idleSeconds: number;
}

export type ConversationOutcome =
  /** جلسة انفتحت، والترحيب والقائمة انبعثوا. */
  | "greeted"
  /** المطعم مغلق: رسالة الإغلاق انبعثت، وولا جلسة انفتحت. */
  | "closed"
  /** جلسة بحالة `browsing`: الرسالة انعالجت بـ`browsing.ts`. */
  | "browsing"
  /** جلسة بحالة `fulfillment_choice`: انعالجت بـ`fulfillment.ts` (ج-3). */
  | "fulfillment_choice"
  /** جلسة بحالة `cart_review`: انعالجت بـ`cart-review.ts` (ج-4). */
  | "cart_review"
  /** جلسة نشطة بحالة ما إلها معالج بعد. انخزنت الرسالة وبس. */
  | "active_session"
  /** خسرنا سباق CAS: حدا تاني رحّب. تجاهل صامت. */
  | "duplicate_ignored"
  /** القائمة أطول من سقف واتساب. انسجّل خطأ، وما انقطعت، وما انفتحت جلسة. */
  | "reply_too_long"
  /**
   * Orders are paused (brief ي-أ, decision 1): ORDERS_PAUSED_AR went out, and
   * nothing else — no session opened, an active one not touched, no order.
   */
  | "orders_paused"
  /**
   * The menu has no item to show (decision 3): ORDERS_PAUSED_AR instead of an
   * empty menu, and no session opened.
   */
  | "empty_menu";

/**
 * رسالة بتنبعت **بعد** ما تُقفل معاملة الرسالة بنجاح — ج §8، الخطوة 7.
 *
 * 🔴 **ليش في طابور أصلا.** باقي المسارات بتبعت جوّا المعاملة، وهاد صح
 *    إلها: أسوأ ما بيصير إن الإرسال بيفشل فبتنسحب المعاملة وميتا بتعيد
 *    الرسالة. بس إنشاء الطلب غير: الطلب **انخلق**، وسحبه بسبب فشل إرسال
 *    بيضيّع طلبا دفع الزبون عمره ليعمله. والعكس أسوأ — إرسال «استلمنا
 *    طلبك» قبل الـCOMMIT بيخلّي الزبون ماسك تأكيدا عن طلب ما انكتب أبدا،
 *    وهو **ما بينسحب** لأنه راح على واتساب.
 *
 *    فالترتيب الوحيد الصحيح: اكتب، اقفل المعاملة، **وبعدين** ابعت. وفشل
 *    الإرسال بعدها بينسجّل وبس — الطلب ما بينمسّ.
 */
export interface DeferredSend {
  readonly restaurantId: string;
  readonly phoneNumberId: string;
  readonly to: string;
  readonly body: string;
}

/**
 * بتبعت طابور ما بعد الـCOMMIT. **ما بترمي أبدا** (ج §8، الخطوة 7): الطلب
 * مكتوب ومقفول، وأي رمية هون بترجّع 500 فتعيد ميتا الرسالة على عطل ما
 * بتصلّحه الإعادة.
 */
export async function flushDeferred(
  sender: WhatsAppSender,
  deferred: readonly DeferredSend[],
): Promise<void> {
  for (const message of deferred) {
    try {
      await sender.sendText(message);
    } catch (error) {
      logger.error(
        { err: error, restaurantId: message.restaurantId },
        "🔴 فشل إرسال رسالة ما بعد الـCOMMIT — الطلب مكتوب وما بينمسّ",
      );
    }
  }
}

export interface ConversationContext {
  restaurantId: string;
  phoneNumberId: string;
  /** رقم الزبون كما وصل من ميتا. */
  from: string;
  /**
   * نص الرسالة، أو `null` لصورة/صوت/موقع.
   *
   * 🔴 إجباري مش اختياري. حقل اختياري بينساه المستدعي بصمت، فكل رسالة
   *    تصفّح بتصير «ما انفهم منها شي» — والعدّاد بيوصّل الزبون لرسالة
   *    الاستسلام وهو عم يكتب أرقاما صحيحة.
   */
  body: string | null;
  /**
   * طابور ما بعد الـCOMMIT. **إجباري مش اختياري**، بنفس سبب `body`: حقل
   * اختياري بينساه المستدعي بصمت، وهون النسيان معناه إن الزبون بيعمل طلبا
   * وما بيوصله ولا تأكيد — وولا اختبار بيسقط. المستدعي اللي بيملك المعاملة
   * هو اللي بيفرّغه بـ`flushDeferred` بعد ما تنجح.
   */
  deferred: DeferredSend[];
}

export class ConversationService {
  /**
   * `now` محقونة عشان اختبارات ساعات الدوام تقدر تثبّت اللحظة.
   *
   * 🔴 البديل — اختبار بيحسب "الساعة كم هلأ" ويبني ساعات دوام حواليها — بيمر
   *    أو بيسقط حسب وقت تشغيله، وبينكسر عند منتصف الليل وبالتوقيت الصيفي. ساعة
   *    محقونة بتخلّي حالة "مطعم بيسكّر الساعة 2:00 ص" تنكتب كحقيقة ثابتة.
   *
   * 🔴 مهلة الجلسة **ما بتقرأ** هالساعة: سكوت الجلسة بينحسب بـ`now()` القاعدة
   *    (بريف ح §0)، فساعة محقونة باختبار ما بتنهي جلسة ولا بتنقذها.
   */
  constructor(
    /** مكشوف عشان مالك المعاملة يفرّغ طابور ما بعد الـCOMMIT (ج §8). */
    readonly sender: WhatsAppSender,
    private readonly now: () => Date = () => new Date(),
    /** مهلة الجلسة بالدقائق (بريف ح §2). */
    private readonly idleMinutes: number = env().SESSION_IDLE_MINUTES,
    /** «آخر طلب لك»: no suggestion with an order younger than this (brief ك). */
    private readonly reorderMinAgeMinutes: number = env()
      .REORDER_MIN_AGE_MINUTES,
  ) {}

  /**
   * بتنستدعى **جوّا** معاملة الاستقبال، بعد ما تنخزّن الرسالة الواردة وسياق
   * المستأجر مضبوط.
   *
   * 🔴 الإرسال بيصير جوّا المعاملة بالقصد. لو فشل إرسال عابر (شبكة، 5xx من
   *    ميتا) بتنسحب المعاملة كلها — الجلسة ومطالبة منع التكرار معها — فميتا
   *    بتعيد الإرسال والزبون بياخد رده من المحاولة الجاية. البديل (إرسال بعد
   *    الـcommit) بيخلّي فشل الإرسال يترك جلسة مفتوحة وزبون ما وصله ولا رد،
   *    وإعادة الإرسال بتنحجب ببوابة منع التكرار — يعني صمت نهائي.
   */
  async handleInbound(
    tx: TenantTx,
    ctx: ConversationContext,
  ): Promise<ConversationOutcome> {
    const restaurant = await this.readRestaurant(tx, ctx.restaurantId);

    // ---------------------------------------------------------------------
    // ١. جلسة نشطة موجودة؟ وقتها ما في ترحيب ولا بوابة — الرسالة انخزنت،
    //    وبس بينتعش وقت آخر رسالة.
    // ---------------------------------------------------------------------
    let existing = await this.findActiveSession(tx, ctx.from);

    // ---------------------------------------------------------------------
    // 🔴 مهلة الجلسة — بريف ح. جلسة سكتت `idleMinutes` أو أكتر بتنتهي
    //    **هون، عند وصول الرسالة**، بلا مهمة خلفية، والرسالة بتكمّل بمسار
    //    الجلسة الجديدة تحت حرفيا: بوابة الدوام، ترحيب ومنيو، سلّة وعدّاد
    //    فاضيين.
    //
    //    بلاها، زبون راجع بعد أيام بيوقع بنص سلّة قديمة — وإذا كان العدّاد
    //    خالص بخطوة الاستلام، بصمت كامل. هاد العطل اللي صار فعلا (29 سبتمبر).
    // ---------------------------------------------------------------------
    if (
      existing !== null &&
      isSessionExpired(existing.idleSeconds, this.idleMinutes)
    ) {
      await this.expireSession(tx, ctx, existing);
      existing = null;
    }

    if (existing !== null) {
      // -------------------------------------------------------------------
      // 🔴 Orders paused, a conversation under way — brief ي-أ §4, step 2.
      //    Before any routing, so «أكّد» too: no handler runs, so no order
      //    is written, and the session is not touched at all — not its
      //    state, its cart or `last_message_at` (decision 1). Once orders
      //    resume, the customer picks up exactly where they were.
      // -------------------------------------------------------------------
      if (restaurant.ordersPaused) {
        await replyOrdersPaused(this.sender, this.recipient(ctx), "paused");
        return "orders_paused";
      }

      if (existing.state === "browsing") {
        // 🔴 ولا `UPDATE` على صف الجلسة قبل هاد النداء — أول قفل عليه لازم
        //    يكون `FOR UPDATE` جوّا `handleBrowsingMessage`. شوف تعليقها.
        await handleBrowsingMessage(tx, this.sender, {
          sessionId: existing.id,
          restaurantId: ctx.restaurantId,
          phoneNumberId: ctx.phoneNumberId,
          to: ctx.from,
          body: ctx.body,
          contactPhone: restaurant.contactPhone,
          offersDelivery: restaurant.offersDelivery,
          deliveryFeeMinor: restaurant.deliveryFeeMinor,
          currency: restaurant.currency,
          now: this.now(),
        });
        return "browsing";
      }
      if (existing.state === "fulfillment_choice") {
        // 🔴 نفس قاعدة `browsing`: ولا `UPDATE` على صف الجلسة قبل النداء.
        //    أول قفل عليه لازم يكون `FOR UPDATE` جوّا المعالج.
        await handleFulfillmentMessage(tx, this.sender, {
          sessionId: existing.id,
          restaurantId: ctx.restaurantId,
          phoneNumberId: ctx.phoneNumberId,
          to: ctx.from,
          body: ctx.body,
          contactPhone: restaurant.contactPhone,
          deliveryFeeMinor: restaurant.deliveryFeeMinor,
          currency: restaurant.currency,
          now: this.now(),
        });
        return "fulfillment_choice";
      }
      if (existing.state === "cart_review") {
        // 🔴 نفس القاعدة: ولا `UPDATE` على صف الجلسة قبل النداء.
        await handleCartReviewMessage(tx, this.sender, {
          sessionId: existing.id,
          restaurantId: ctx.restaurantId,
          phoneNumberId: ctx.phoneNumberId,
          to: ctx.from,
          body: ctx.body,
          contactPhone: restaurant.contactPhone,
          deliveryFeeMinor: restaurant.deliveryFeeMinor,
          currency: restaurant.currency,
          deferred: ctx.deferred,
          now: this.now(),
        });
        return "cart_review";
      }
      await tx
        .update(conversationSessions)
        .set({ lastMessageAt: this.now() })
        .where(eq(conversationSessions.id, existing.id));
      return "active_session";
    }

    // ---------------------------------------------------------------------
    // ٢. 🔴 بوابة ساعات الدوام — FR-22. قبل أي جلسة، وقبل أي قائمة.
    // ---------------------------------------------------------------------
    // مفتاح `timezone` جوّا الـjsonb مهجور من 0008 والهجرة شالته. رجوعه معناه
    // إشي كتبه من جديد وبيتوقّع إنه بينقرا — وهو ما بينقرا. سطر تحذير بدل عطل صامت.
    const legacyZone = legacyTimezoneKey(restaurant.businessHours);
    if (legacyZone !== null) {
      logger.warn(
        { restaurantId: ctx.restaurantId, legacyZone },
        "business_hours فيه مفتاح timezone مهجور — العمود restaurants.timezone هو المقروء",
      );
    }

    const hours = decideHours(
      restaurant.businessHours,
      restaurant.timezone,
      this.now(),
    );
    if (!hours.open) {
      await this.sender.sendText({
        restaurantId: ctx.restaurantId,
        phoneNumberId: ctx.phoneNumberId,
        to: ctx.from,
        body: closedMessageAr(hours.todayWindow),
      });
      logger.info(
        { restaurantId: ctx.restaurantId, from: maskPhone(ctx.from) },
        "المطعم مغلق — ولا جلسة انفتحت",
      );
      return "closed";
    }

    // ---------------------------------------------------------------------
    // 🔴 Orders paused, a new conversation — brief ي-أ §4, step 5. After the
    //    hours gate on purpose: a closed restaurant's text carries its hours,
    //    which tells the customer more. And like a closed restaurant, no
    //    session is opened: the first message after orders resume is
    //    welcomed with the menu.
    // ---------------------------------------------------------------------
    if (restaurant.ordersPaused) {
      await replyOrdersPaused(this.sender, this.recipient(ctx), "paused");
      return "orders_paused";
    }

    // ---------------------------------------------------------------------
    // ٣. 🔴 الرد بينبنى وطوله بينفحص **قبل** ما تنفتح الجلسة.
    //
    //    قائمة أطول من سقف واتساب مشكلة **دائمة**: بتنحل بقائمة أقصر، مش
    //    بإعادة محاولة. والترتيب هون هو اللي بيخلّي الحالة تتعافى لحالها:
    //
    //      - ولا جلسة بتنفتح، فأول رسالة بعد ما المطعم يقصّر قائمته بتلاقي
    //        الطريق مفتوح وبتاخد ترحيبها عاديا. لو انفتحت جلسة، رسايل الزبون
    //        الجاية بتمرق من فرع "جلسة نشطة" وبيضل بلا قائمة للأبد.
    //      - المعاملة **ما بتنسحب**: الرسالة الواردة بتضل مخزّنة ومطالبة منع
    //        التكرار بتضل ثابتة، والرد 200. الانسحاب هون بيمسح رسالة الزبون
    //        ويرجّعها لطابور ميتا اللي بيعيدها سبعة أيام على عطل إعادة
    //        المحاولة ما بتصلّحه.
    //
    //    «آخر طلب لك» (brief ك) is read here, before `prepareMenu`, which
    //    builds it into the text and measures it with the rest — so the
    //    order above stays as it is. By the customer's number, not the
    //    upserted row: a number with no customer yet has no order either.
    //    On this path alone — a new conversation, past the hours and pause
    //    gates; «منيو» and an active session never see it.
    // ---------------------------------------------------------------------
    const reorder = await findReorderSource(
      tx,
      ctx.from,
      this.reorderMinAgeMinutes,
    );
    const prepared = await prepareMenu(
      tx,
      restaurant.name,
      restaurant.currency,
      reorder,
    );
    if (!prepared.ok) {
      if (prepared.reason === "empty") {
        // 🔴 Not one item to show (decision 3): the paused text instead of an
        //    empty menu, and no session — so the first message after an item
        //    is back on is welcomed with the menu, as a closed restaurant's is.
        await replyOrdersPaused(this.sender, this.recipient(ctx), "empty_menu");
        return "empty_menu";
      }
      logger.error(
        {
          restaurantId: ctx.restaurantId,
          chars: prepared.error.length,
          limit: prepared.error.limit,
        },
        "🔴 القائمة أطول من سقف واتساب — ما انبعثت وما انقطعت. قصّر القائمة",
      );
      return "reply_too_long";
    }
    const menu = prepared.menu;
    if (prepared.reorderDroppedAt !== null) {
      logger.info(
        {
          restaurantId: ctx.restaurantId,
          from: maskPhone(ctx.from),
          chars: prepared.reorderDroppedAt,
        },
        "«آخر طلب لك» بيطوّل أول رسالة فوق سقف واتساب — انبعتت بلاه",
      );
    }

    const customerId = await this.upsertCustomer(
      tx,
      ctx.restaurantId,
      ctx.from,
    );
    const sessionId = await this.openSession(tx, ctx.restaurantId, customerId);
    if (sessionId === null) {
      // ما قدرنا نمسك الجلسة إطلاقا — سباق انتهى لصالح غيرنا وما عاد في صف
      // نشط نقرأه. تجاهل صامت، زي ضغطة مكررة.
      return "duplicate_ignored";
    }

    // ---------------------------------------------------------------------
    // ٤. 🔴 CAS: 'new' -> 'browsing'. **الترحيب بينبعت من اللي بيفوز بس.**
    //
    //    الفهرس الفريد بـ0007 بيمنع جلستين. هاي بتمنع ترحيبين على نفس الجلسة:
    //    الخاسر بالسباق بيقرأ صف الفائز، وبيلاقي حالته صارت 'browsing'،
    //    فـrowcount بيصير صفر وبيسكت. صفر هون = ضغطة مكررة، تُتجاهَل بصمت.
    // ---------------------------------------------------------------------
    if (!(await advanceSessionState(tx, sessionId, "new", "browsing"))) {
      logger.debug(
        { restaurantId: ctx.restaurantId, sessionId },
        "CAS خسر — حدا تاني رحّب. تجاهل صامت",
      );
      return "duplicate_ignored";
    }

    // 🔴 كتابة `menu_map` والإرسال فعل واحد — `deliverMenu` بتعملهم بالترتيب
    //    الصح. ممنوع نداء `sendText` بنص قائمة من هون أو من أي مكان تاني.
    await deliverMenu(tx, this.sender, {
      sessionId,
      restaurantId: ctx.restaurantId,
      phoneNumberId: ctx.phoneNumberId,
      to: ctx.from,
      menu,
      now: this.now(),
    });

    logger.info(
      {
        restaurantId: ctx.restaurantId,
        sessionId,
        from: maskPhone(ctx.from),
        items: menu.lines.length,
      },
      "جلسة انفتحت والترحيب انبعث",
    );
    if (menu.reorder !== null) {
      logger.info(
        {
          restaurantId: ctx.restaurantId,
          from: maskPhone(ctx.from),
          items: menu.reorder.items.length,
          sourceOrderId: menu.reorder.order_id,
        },
        "«آخر طلب لك» انعرض",
      );
    }
    return "greeted";
  }

  /** Where a reply to this message goes — the restaurant's number to the customer. */
  private recipient(ctx: ConversationContext): {
    restaurantId: string;
    phoneNumberId: string;
    to: string;
  } {
    return {
      restaurantId: ctx.restaurantId,
      phoneNumberId: ctx.phoneNumberId,
      to: ctx.from,
    };
  }

  private async readRestaurant(
    tx: TenantTx,
    restaurantId: string,
  ): Promise<{
    name: string;
    businessHours: unknown;
    timezone: string;
    contactPhone: string | null;
    offersDelivery: boolean;
    deliveryFeeMinor: number;
    currency: Currency;
    /** `restaurants.orders_paused_at IS NOT NULL` (brief ي-أ §2). */
    ordersPaused: boolean;
  }> {
    // 🔴 `resolve_restaurant_by_phone_id` بترجّع uuid وبس، فالاسم وساعات الدوام
    //    والمنطقة الزمنية بدهم قراءة. الشرط على المعرّف مش هو اللي بيعزل — سياسة tenant_isolation
    //    بـ0003 بتعزل. موجود عشان الفشل يكون صريح لو السياق ما انضبط.
    const [row] = await tx
      .select({
        name: restaurants.name,
        businessHours: restaurants.businessHours,
        timezone: restaurants.timezone,
        contactPhone: restaurants.contactPhone,
        offersDelivery: restaurants.offersDelivery,
        deliveryFee: restaurants.deliveryFee,
        // 🔴 مع بيانات المطعم اللي بتنقرأ أصلا بكل رسالة (بريف د §2.2)، **بلا
        //    snapshot بالجلسة**: العملة ما بتتغيّر بنص محادثة.
        currency: restaurants.currency,
        // 🔴 Read with every message, like the rest of the row: a pause
        //    applies from the very next message, with no session to wait out.
        ordersPausedAt: restaurants.ordersPausedAt,
      })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId))
      .limit(1);

    if (row === undefined) {
      throw new Error(
        `صف المطعم ${restaurantId} غير مقروء — سياق المستأجر مش مضبوط`,
      );
    }
    // 🔴 التحويل بـ`priceToMinor` القائمة، لا بـ`(delivery_fee * 100)::int`
    //    (ج §15.4): **مسار تحويل واحد** للقراءة بالسلّة كلها — نفس الدالة
    //    اللي بتقرأ سعر الصنف. مساران بيخلّوا رقمين يتفاوتا بقرش بلا ما
    //    يسقط إشي.
    const { deliveryFee, ordersPausedAt, ...rest } = row;
    return {
      ...rest,
      deliveryFeeMinor: priceToMinor(deliveryFee),
      ordersPaused: ordersPausedAt !== null,
    };
  }

  /**
   * الزبون بينكتب أو بينقرأ بعملية وحدة.
   *
   * `ON CONFLICT DO UPDATE` مش `DO NOTHING`: الأخيرة بترجّع صفر صفوف لزبون
   * موجود، فبتحتاج SELECT تانية ورا كل رسالة. `DO UPDATE` بترجّع المعرّف
   * بالحالتين بعملية ذرّية وحدة، وبتتحمّل سباقا على زبون جديد.
   */
  private async upsertCustomer(
    tx: TenantTx,
    restaurantId: string,
    phone: string,
  ): Promise<string> {
    const [row] = await tx
      .insert(customers)
      .values({ restaurantId, phoneNumber: phone })
      .onConflictDoUpdate({
        target: [customers.restaurantId, customers.phoneNumber],
        set: { updatedAt: new Date() },
      })
      .returning({ id: customers.id });

    if (row === undefined) throw new Error("ما انكتب صف زبون");
    return row.id;
  }

  private async findActiveSession(
    tx: TenantTx,
    phone: string,
  ): Promise<ActiveSession | null> {
    const [row] = await tx
      .select({
        id: conversationSessions.id,
        state: conversationSessions.state,
        // 🔴 السكوت بساعة القاعدة، مش بساعة Node (بريف ح §0): `now()` هي
        //    بداية معاملة الرسالة. القرار نفسه بـ`isSessionExpired`.
        idleSeconds:
          sql<number>`extract(epoch from now() - ${conversationSessions.lastMessageAt})::float8`.mapWith(
            Number,
          ),
      })
      .from(conversationSessions)
      .innerJoin(customers, eq(customers.id, conversationSessions.customerId))
      .where(
        and(
          eq(customers.phoneNumber, phone),
          notInArray(conversationSessions.state, [...CLOSED_STATES]),
        ),
      )
      .orderBy(desc(conversationSessions.lastMessageAt))
      .limit(1);

    return row ?? null;
  }

  /**
   * بتنهي جلسة سكتت أكتر من المهلة: CAS على الحالة اللي انقرأت (بريف ح §2).
   *
   * 🔴 مش `advanceSessionState`: هاي بتكتب `last_message_at` مع الحالة، وهون
   *    الصف القديم لازم يضل **كما هو** — آخر رسالة من الزبون فيه، وسلّته،
   *    حقيقة للتدقيق. الحالة وبس بتتغيّر.
   *
   * 🔴 صفر صفوف = رسالة تانية سبقتنا وأنهتها. مش خطأ: المستدعي بيكمّل بمسار
   *    الجلسة الجديدة، والفهرس الفريد بـ0007 مع CAS الترحيب بيخلّوا الخاسر
   *    يسكت هناك.
   *
   * هاد `UPDATE` بيصير بس على جلسة منتهية، وهي ما بتوصل لأي معالج بعده،
   * فقاعدة «`FOR UPDATE` أول شي بيلمس صف الجلسة» (`browsing.ts`) ما بتنمسّ.
   */
  private async expireSession(
    tx: TenantTx,
    ctx: ConversationContext,
    session: ActiveSession,
  ): Promise<void> {
    const expired = await tx
      .update(conversationSessions)
      .set({ state: "abandoned" })
      .where(
        and(
          eq(conversationSessions.id, session.id),
          eq(conversationSessions.state, session.state),
        ),
      )
      .returning({ id: conversationSessions.id });

    if (expired.length === 0) {
      logger.debug(
        { restaurantId: ctx.restaurantId, sessionId: session.id },
        "CAS الانتهاء خسر — رسالة تانية سبقتنا. مسار الجلسة الجديدة بيحكم",
      );
      return;
    }

    logger.info(
      {
        restaurantId: ctx.restaurantId,
        sessionId: session.id,
        state: session.state,
        idleMinutes: Math.floor(session.idleSeconds / 60),
        from: maskPhone(ctx.from),
      },
      "جلسة انتهت بعد سكوت — الرسالة بتبلّش جلسة جديدة",
    );
  }

  /**
   * بتفتح جلسة، أو بترجّع جلسة اللي سبقنا بالسباق.
   *
   * 🔴 `ON CONFLICT DO NOTHING RETURNING` مع الفهرس الفريد بـ0007 هو اللي
   *    بيخلّي "رسالتين بفارق ميلي ثانية" تعطي جلسة وحدة. فحص-ثم-إدراج بيمرّق
   *    الاتنين مهما كان الترتيب.
   */
  private async openSession(
    tx: TenantTx,
    restaurantId: string,
    customerId: string,
  ): Promise<string | null> {
    const created = await tx
      .insert(conversationSessions)
      .values({ restaurantId, customerId, state: "new" })
      .onConflictDoNothing()
      .returning({ id: conversationSessions.id });

    const mine = created[0]?.id;
    if (mine !== undefined) return mine;

    // خسرنا السباق: الفائز commit قبلنا. بنقرأ صفّه وبنترك الـCAS يحكم.
    const [winner] = await tx
      .select({ id: conversationSessions.id })
      .from(conversationSessions)
      .where(
        and(
          eq(conversationSessions.customerId, customerId),
          notInArray(conversationSessions.state, [...CLOSED_STATES]),
        ),
      )
      .limit(1);

    return winner?.id ?? null;
  }
}
