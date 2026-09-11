import { and, desc, eq, notInArray } from "drizzle-orm";
import {
  closedMessageAr,
  conversationSessions,
  customers,
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
import { buildMenu } from "../restaurant/menu.js";
import {
  OutboundTextTooLongError,
  assertWithinTextLimit,
  type WhatsAppSender,
} from "../whatsapp/sender.js";

/**
 * الشريحة الأولى من المحادثة: بوابة ساعات الدوام، فتح الجلسة، وأول رد.
 *
 * ⛔ حدود الشريحة، وكلها مقصودة: ولا سلة، ولا عنوان، ولا دفع، ولا إنشاء طلب.
 *    رسالة من زبون عنده جلسة نشطة بتنخزّن وبيتحدّث `last_message_at` وبس —
 *    آلة الحالات اللي بتقرا محتوى الرسالة شريحة جاية.
 */

/** الحالات اللي معناها "الجلسة خلصت". نفس تعريف 0002 و0007 بالضبط. */
const CLOSED_STATES = ["order_placed", "abandoned"] as const;

export type ConversationOutcome =
  /** جلسة انفتحت، والترحيب والقائمة انبعثوا. */
  | "greeted"
  /** المطعم مغلق: رسالة الإغلاق انبعثت، وولا جلسة انفتحت. */
  | "closed"
  /** جلسة نشطة موجودة أصلا. انخزنت الرسالة وبس — آلة الحالات مش هون. */
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
    const menu = await buildMenu(tx);
    const body = `${welcomeMessageAr(restaurant.name)}\n${menu.text}`;
    try {
      assertWithinTextLimit(body);
    } catch (error) {
      if (!(error instanceof OutboundTextTooLongError)) throw error;
      logger.error(
        {
          restaurantId: ctx.restaurantId,
          chars: error.length,
          limit: error.limit,
          items: menu.lines.length,
        },
        "🔴 القائمة أطول من سقف واتساب — ما انبعثت وما انقطعت. قصّر القائمة",
      );
      return "reply_too_long";
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

    await this.sender.sendText({
      restaurantId: ctx.restaurantId,
      phoneNumberId: ctx.phoneNumberId,
      to: ctx.from,
      body,
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
  ): Promise<{ name: string; businessHours: unknown; timezone: string }> {
    // 🔴 `resolve_restaurant_by_phone_id` بترجّع uuid وبس، فالاسم وساعات الدوام
    //    والمنطقة الزمنية بدهم قراءة. الشرط على المعرّف مش هو اللي بيعزل — سياسة tenant_isolation
    //    بـ0003 بتعزل. موجود عشان الفشل يكون صريح لو السياق ما انضبط.
    const [row] = await tx
      .select({
        name: restaurants.name,
        businessHours: restaurants.businessHours,
        timezone: restaurants.timezone,
      })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId))
      .limit(1);

    if (row === undefined) {
      throw new Error(
        `صف المطعم ${restaurantId} غير مقروء — سياق المستأجر مش مضبوط`,
      );
    }
    return row;
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
