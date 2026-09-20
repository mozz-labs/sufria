import { and, desc, eq, notInArray } from "drizzle-orm";
import {
  closedMessageAr,
  conversationSessions,
  customers,
  priceToMinor,
  restaurants,
  welcomeMessageAr,
} from "@sufria/shared";

import { advanceSessionState } from "../db/critical-primitives.js";
import type { TenantTx } from "../db/types.js";
import { logger, maskPhone } from "../logger.js";
import {
  decideHours,
  legacyTimezoneKey,
} from "../restaurant/business-hours.js";
import type { WhatsAppSender } from "../whatsapp/sender.js";
import { handleBrowsingMessage } from "./browsing.js";
import { handleFulfillmentMessage } from "./fulfillment.js";
import { deliverMenu, prepareMenu } from "./menu-delivery.js";

/**
 * المحادثة: بوابة ساعات الدوام، فتح الجلسة، أول رد — والتصفّح والسلّة (ب-4).
 *
 * جلسة بحالة `browsing` بتروح لـ`browsing.ts`: إضافة، عرض، حذف، «منيو»،
 * والعدّاد. باقي الحالات (`cart_review` وما بعدها) لسا بتتحدّث
 * `last_message_at` وبس — مهام جاية.
 *
 * ⛔ ولا عنوان، ولا دفع، ولا إنشاء طلب. و«تم» ب-5.
 */

/** الحالات اللي معناها "الجلسة خلصت". نفس تعريف 0002 و0007 بالضبط. */
const CLOSED_STATES = ["order_placed", "abandoned"] as const;

export type ConversationOutcome =
  /** جلسة انفتحت، والترحيب والقائمة انبعثوا. */
  | "greeted"
  /** المطعم مغلق: رسالة الإغلاق انبعثت، وولا جلسة انفتحت. */
  | "closed"
  /** جلسة بحالة `browsing`: الرسالة انعالجت بـ`browsing.ts`. */
  | "browsing"
  /** جلسة بحالة `fulfillment_choice`: انعالجت بـ`fulfillment.ts` (ج-3). */
  | "fulfillment_choice"
  /** جلسة نشطة بحالة ما إلها معالج بعد. انخزنت الرسالة وبس. */
  | "active_session"
  /** خسرنا سباق CAS: حدا تاني رحّب. تجاهل صامت. */
  | "duplicate_ignored"
  /** القائمة أطول من سقف واتساب. انسجّل خطأ، وما انقطعت، وما انفتحت جلسة. */
  | "reply_too_long";

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
}

export class ConversationService {
  /**
   * `now` محقونة عشان اختبارات ساعات الدوام تقدر تثبّت اللحظة.
   *
   * 🔴 البديل — اختبار بيحسب "الساعة كم هلأ" ويبني ساعات دوام حواليها — بيمر
   *    أو بيسقط حسب وقت تشغيله، وبينكسر عند منتصف الليل وبالتوقيت الصيفي. ساعة
   *    محقونة بتخلّي حالة "مطعم بيسكّر الساعة 2:00 ص" تنكتب كحقيقة ثابتة.
   */
  constructor(
    private readonly sender: WhatsAppSender,
    private readonly now: () => Date = () => new Date(),
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
    const existing = await this.findActiveSession(tx, ctx.from);
    if (existing !== null) {
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
          now: this.now(),
        });
        return "fulfillment_choice";
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
    // ---------------------------------------------------------------------
    const prepared = await prepareMenu(tx, welcomeMessageAr(restaurant.name));
    if (!prepared.ok) {
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
    return "greeted";
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
    const { deliveryFee, ...rest } = row;
    return { ...rest, deliveryFeeMinor: priceToMinor(deliveryFee) };
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
  ): Promise<{ id: string; state: string } | null> {
    const [row] = await tx
      .select({
        id: conversationSessions.id,
        state: conversationSessions.state,
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
