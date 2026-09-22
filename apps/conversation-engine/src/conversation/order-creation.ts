import { sql } from "drizzle-orm";
import {
  conversationSessions,
  orderItems,
  orderStatusHistory,
  orders,
  type SummaryFulfillment,
} from "@sufria/shared";
import { eq } from "drizzle-orm";

import type { TenantTx } from "../db/types.js";
import { readCatalog } from "../restaurant/catalog.js";
import { pruneUnavailable } from "./menu-delivery.js";
import { cartTotalMinor } from "./cart-view.js";
import type { SessionData } from "./session-data.js";

/**
 * إنشاء الطلب — بريف ج §8، جوّا **معاملة الرسالة نفسها** والجلسة مقفولة
 * بـ`FOR UPDATE` من `readSessionData`.
 *
 * 🔴 **الإرسال مش هون.** الخطوة 7 من §8 بتصير بعد الـCOMMIT، عبر طابور
 *    `DeferredSend`. هاد الملف بيكتب وبس.
 *
 * 🔴 **القيود بالقاعدة هي شبكة الأمان، مش تزيين** (§8):
 *      - `total = subtotal + delivery_fee`
 *      - `actor='staff'` ⟺ `actor_staff_id IS NOT NULL`
 *      - استلام ⇒ ولا رسوم ولا عنوان · توصيل ⇒ عنوان من 1 لـ300
 *    أي خطأ حسابي أو فرع غلط بيسقّط المعاملة كلها بدل ما يوصل المطبخ طلب
 *    غلط. **ما بينلتفّ عليها.**
 */

/** نتيجة فحص التوفّر الحيّ — الخطوة 1. */
export type AvailabilityOutcome =
  /** كل الأسطر متوفرة: الطلب بينخلق. */
  | { readonly kind: "all-available" }
  /** سقط صنف أو أكثر وبقي شي: **لا طلب**، والسلّة المقلَّمة بتنكتب. */
  | {
      readonly kind: "pruned";
      readonly cart: SessionData["cart"];
      readonly removed: readonly string[];
    }
  /** سقط كل شي: **لا طلب**، والسلّة بتفضى. */
  | { readonly kind: "emptied"; readonly removed: readonly string[] };

/**
 * الخطوة 1 — **فحص توفّر حيّ لكل سطر**، بنفس دالة التقليم اللي بيستعملها
 * كاتب الخريطة (`f436f0a`)، فصفّ ممسوح كليا = غير متوفر.
 *
 * 🔴 الفحص عند الإضافة وحده ما بيكفي، وفحص كتابة الخريطة كمان لأ: السلّة
 *    بتقعد دقايق، و«منيو» ممكن ما تجي مرة تانية أبدا (§16.6).
 *    **السعر وعد، والتوفّر واقع.**
 */
export async function checkAvailability(
  tx: TenantTx,
  data: SessionData,
): Promise<AvailabilityOutcome> {
  const catalog = await readCatalog(
    tx,
    data.cart.map((l) => l.item_id),
  );
  const pruned = pruneUnavailable(data.cart, catalog);
  if (pruned.removed.length === 0) return { kind: "all-available" };
  return pruned.cart.length === 0
    ? { kind: "emptied", removed: pruned.removed }
    : { kind: "pruned", cart: pruned.cart, removed: pruned.removed };
}

export interface CreatedOrder {
  readonly orderId: string;
  /** اللي بيقوله الزبون عالكاونتر — نفسه اللي بـ«استلمنا» (بريف د §2.1). */
  readonly orderNumber: number;
  readonly outboundCount: number;
}

/**
 * الـnamespace تبع القفل الاستشاري اللي بيسلسل تخصيص رقم الطلب — **لهاد
 * القفل وحده** (بريف د §2.1). المفتاح التاني `hashtext(restaurant_id)`، فالقفل
 * بيسلسل طلبات **نفس المطعم** وبس، ومطعمان ما بيستنّوا بعض.
 *
 * تصادم `hashtext` بين مطعمين بيسلسلهم على بعض بلا داعي — أبطأ، مش أغلط.
 */
const ORDER_NUMBER_LOCK_NS = 11;

/**
 * رقم الطلب الجاي لهاد المطعم — من 101، متسلسل، ما بيتصفّر.
 *
 * 🔴 **جملتان، مش جملة وحدة.** بـREAD COMMITTED (مستوى العزل القائم، فحص
 *    د-0 #9) كل جملة بتاخد snapshot لحظة ما تبلّش. الـ`MAX` بجملة لحالها بعد
 *    ما رجع القفل بيشوف طلب اللي كان ماسكه، لأنه اتكوّم قبل ما يتحرّر القفل.
 *    `MAX` بنفس جملة القفل كانت بتاخد snapshot **قبل** الانتظار، فبتشوف نفس
 *    الـMAX اللي شافه الأول — وبتصير تصادم على القيد الفريد بالذروة.
 *
 *    والقفل بيتحرّر بالـCOMMIT وحده (`xact`)، فالرقم محجوز لحد ما يا بينكتب
 *    الطلب، يا بتنسحب المعاملة كلها ومعها الحجز.
 *
 * 🔴 **القيد `orders_restaurant_order_number_unique` شبكة الأمان، مش الآلية.**
 *    بلا القفل، طلبان بنفس اللحظة بيقرأوا نفس الـMAX، والتاني بيسقط عالقيد —
 *    يعني زبون كتب «أكّد» وطلبه ما انكتب.
 */
async function allocateOrderNumber(
  tx: TenantTx,
  restaurantId: string,
): Promise<number> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${ORDER_NUMBER_LOCK_NS}::int, hashtext(${restaurantId}::text))`,
  );
  const [row] = await tx
    .select({
      next: sql<number>`COALESCE(MAX(${orders.orderNumber}), 100) + 1`,
    })
    .from(orders)
    .where(eq(orders.restaurantId, restaurantId));
  if (row === undefined) throw new Error("ما انقرأ رقم الطلب الجاي");
  return row.next;
}

/**
 * الخطوات 3 إلى 5 — الطلب وأصنافه وسطر تاريخه، بمعاملة واحدة.
 * المستدعي بيكون عمل الـCAS (الخطوة 2) قبلها، وبيكتب `SessionData` بعدها.
 *
 * 🔴 **المال بيوصل هون أعدادا صحيحة بالقروش، والقسمة على 100 بتصير بالـSQL**
 *    (`$n::numeric / 100` — §8 و§15.4). ولا ضرب ولا قسمة بالـJS عند الكتابة:
 *    `numeric(12,2)` بتدوّر معظم أخطاء الـfloat فتخفيها، **وهاد اللي بيخلّيها
 *    صامتة**.
 */
export async function insertOrder(
  tx: TenantTx,
  args: {
    readonly sessionId: string;
    readonly restaurantId: string;
    readonly data: SessionData;
    readonly fulfillment: SummaryFulfillment;
  },
): Promise<CreatedOrder> {
  const { sessionId, restaurantId, data, fulfillment } = args;

  // الزبون بيجي من صف الجلسة نفسه — المقفول أصلا بـ`FOR UPDATE`.
  const [session] = await tx
    .select({ customerId: conversationSessions.customerId })
    .from(conversationSessions)
    .where(eq(conversationSessions.id, sessionId))
    .limit(1);
  if (session === undefined) {
    throw new Error(`صف الجلسة ${sessionId} غير مقروء عند إنشاء الطلب`);
  }

  const subtotalMinor = cartTotalMinor(data.cart);
  const feeMinor = fulfillment.type === "delivery" ? fulfillment.feeMinor : 0;
  // 🔴 أعداد صحيحة. القيد `total = subtotal + delivery_fee` بيمسك أي خلل هون.
  const totalMinor = subtotalMinor + feeMinor;
  const outboundCount = data.outbound_count + 1;

  // --- بين الخطوتين 2 و3: رقم الطلب (بريف د §2.1) ----------------------------
  // بعد الـCAS بالقصد: «أكّد» التانية اللي خسرت الـCAS ما بتوصل هون، فما
  // بتستنّى عالقفل ولا بتحجز رقما.
  const orderNumber = await allocateOrderNumber(tx, restaurantId);

  // --- الخطوة 3 -------------------------------------------------------------
  const [order] = await tx
    .insert(orders)
    .values({
      restaurantId,
      customerId: session.customerId,
      orderNumber,
      // 🔴 اسم العمود `session_id`، مش `conversation_session_id` (§15.2).
      sessionId,
      fulfillmentType: fulfillment.type,
      // كاش وبس بالبايلوت: بوابة الدفع ممنوعة **بالكيان لا بالكود** (§2.5).
      paymentMethod: "cash",
      paymentStatus: "pending_cash",
      status: "pending_acceptance",
      /**
       * 🔴 `true` **صراحة، ضد الافتراضي** (§15.3). `notified = false` معناها
       *    «المُراقِب لازم يبعت» (البلوبرينت 663-670 وفهرس `idx_orders_unnotified`)،
       *    والمحرّك هو اللي بيبعت «استلمنا طلبك» بعد الـCOMMIT. تركها
       *    افتراضية بتوصّل الزبون **رسالتين** يوم ما ينبني المُراقِب.
       *    انحراف عن البلوبرينت 395، مسجّل بـ§12.
       */
      notified: true,
      subtotal: sql`${subtotalMinor}::numeric / 100`,
      deliveryFee: sql`${feeMinor}::numeric / 100`,
      total: sql`${totalMinor}::numeric / 100`,
      // النص الخام زي ما كتبه الزبون. سائق بيقرأه.
      deliveryAddress:
        fulfillment.type === "delivery" ? fulfillment.address : null,
      // رسائل التصفّح كلها + «استلمنا». مدخل تسعير الاشتراك (ب §4).
      outboundMsgCount: outboundCount,
    })
    .returning({ id: orders.id });
  if (order === undefined) throw new Error("ما انكتب صف طلب");

  // --- الخطوة 4 -------------------------------------------------------------
  // 🔴 `restaurant_id` على **كل** صف: الـFK المركّب بيربطه بالطلب، وسياسة
  //    RLS بتصير فحص مساواة مفهرس بدل استعلام مرتبط (ADR-002 §1).
  // 🔴 و`item_name_snapshot` من `SessionData.cart[].name` — العمود موجود
  //    و`NOT NULL`، والافتراض بـ§1 كان غلطا (§15.1).
  await tx.insert(orderItems).values(
    data.cart.map((line) => ({
      orderId: order.id,
      restaurantId,
      menuItemId: line.item_id,
      itemNameSnapshot: line.name,
      unitPriceSnapshot: sql`${line.unit_price_minor}::numeric / 100`,
      quantity: line.qty,
    })),
  );

  // --- الخطوة 5 -------------------------------------------------------------
  // 🔴 `actor='customer'` و`actor_staff_id = NULL`: القيد
  //    `osh_actor_staff_consistent` بيفرض إنهم يمشوا مع بعض.
  await tx.insert(orderStatusHistory).values({
    orderId: order.id,
    restaurantId,
    fromStatus: null,
    toStatus: "pending_acceptance",
    actor: "customer",
    actorStaffId: null,
  });

  return { orderId: order.id, orderNumber, outboundCount };
}
