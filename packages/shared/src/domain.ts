/**
 * أنواع النطاق المشتركة. الفرونت اند بيستوردها زي الباك اند بالضبط،
 * فلو حدا غيّر حالة طلب بالباك اند وما عدّل الواجهة، الـtypecheck بيوقع.
 */

export const ORDER_STATUSES = [
  "pending_acceptance",
  "accepted",
  "preparing",
  "ready",
  "completed",
  "cancelled",
  "expired",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = [
  "pending_cash",
  "pending_online",
  "paid",
  "collected",
  "refunded",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** مرآة `cancelled_by` بـ0001. الطلب الملغي دايما إله جهة ألغته (CHECK بالهجرة). */
export const CANCELLED_BY = ["customer", "restaurant", "system"] as const;
export type CancelledBy = (typeof CANCELLED_BY)[number];

/**
 * شارات حالة الطلب بلوحة الموظفين. DESIGN.md §4 — لا تُكتب inline بأي مكان تاني.
 *
 * هاي **شارات**، مش رسائل. كلمة وحدة بتنقرأ بلمحة جوّا badge ضيّق وقت الضغط.
 * الرسائل اللي بتوصل الزبون مفردة تانية بالكامل — شوف ORDER_STATUS_MESSAGE_AR.
 * لا تخلط الاتنين ولا تعيد استخدام وحدة محل التانية.
 */
export const ORDER_STATUS_LABEL_AR: Record<OrderStatus, string> = {
  pending_acceptance: "معلّق",
  accepted: "مقبول",
  preparing: "قيد التحضير",
  ready: "جاهز",
  completed: "مكتمل",
  cancelled: "ملغى",
  expired: "غير مستلَم",
};

/**
 * شارات حالة الدفع — وحدة بس، وهاد مقصود.
 *
 * `collected` لحالها إلها شارة لأنها بتوثّق حدث (الكاشير استلم الكاش).
 * 🔴 `pending_cash` حالة حيّة **بلا شارة**: الدفع نقدا عند الاستلام هو الوضع
 * الطبيعي لأغلب الطلبات، وشارة عليه بتحط ضجيج على كل بطاقة بلا ما تضيف معلومة.
 * غياب الشارة هو التصميم، مش نقص — لا تضيف إلها نصا.
 * الباقي (`pending_online` / `paid` / `refunded`) لسا بلا نص معتمد.
 */
export const PAYMENT_STATUS_LABEL_AR: Partial<Record<PaymentStatus, string>> = {
  collected: "محصَّل",
};

/**
 * الخانة اللي بتنستبدل بسبب الإلغاء قبل الإرسال. مصدّرة عشان ما حدا يكتب
 * النص الحرفي بمكان النداء — لو انبعثت الرسالة بلا استبدال، الزبون بيشوف الخانة.
 */
export const ORDER_CANCELLATION_REASON_SLOT = "[السبب]";

/**
 * رسائل الواتساب اللي بتوصل الزبون. **مفردة منفصلة عن الشارات فوق** —
 * الشارة حالة بتُقرأ، والرسالة جملة بتُبعت. نفس المفتاح، نصان مختلفان بقصد.
 *
 * 🔴 `preparing` و `completed` بلا رسالة، وهاد قرار مش سهو:
 *   - `preparing` — المطعم بيضغط "قبول" و"قيد التحضير" ورا بعض بثواني.
 *     رسالة عليه بتوصل الزبون كإشعار تاني بلا معلومة جديدة بعد «أكّدنا طلبك.».
 *   - `completed` — الزبون ماسك طلبه بإيده وقت ما بتنضغط. رسالة "طلبك مكتمل"
 *     بتوصله وهو طالع من المحل.
 *   الاتنين ضجيج على قناة الزبون الشخصية، وكل رسالة زيادة بتقرّب حظر الرقم.
 *   **ما بينضاف إلهم نص لاحقا بلا قرار منتج مكتوب يلغي هالتعليق.**
 *
 * `system` (ثالث قيم `cancelled_by`، بيطلع من مهمة B-2 لطلبات الدفع العالقة)
 * لسا بلا نص معتمد — البحث عنه لازم يكون صريح، ما بينحل بقيمة افتراضية.
 */
export const ORDER_STATUS_MESSAGE_AR = {
  /** الاستلام: أول رد بعد ما بينحفظ الطلب، قبل ما المطعم يشوفه. */
  pending_acceptance: "استلمنا طلبك — التأكيد خلال دقائق.",
  accepted: "أكّدنا طلبك.",
  ready: "طلبك جاهز للاستلام.",
  /** بيتفرّع حسب `cancelled_by` — مين ألغى بيغيّر الجملة، مش بس السبب. */
  cancelled: {
    restaurant: `ألغينا طلبك — ${ORDER_CANCELLATION_REASON_SLOT}.`,
    customer: "ألغينا الطلب حسب طلبك.",
  },
} as const;

/**
 * الانتقالات المسموحة. مصدر الحقيقة الوحيد — الباك اند بيتحقق منها
 * والفرونت اند بيعطّل الأزرار حسبها. FR-13.
 */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> =
  {
    pending_acceptance: ["accepted", "cancelled"],
    accepted: ["preparing", "cancelled"],
    preparing: ["ready", "completed", "cancelled"],
    ready: ["completed", "cancelled", "expired"],
    completed: [],
    cancelled: [],
    expired: [],
  };

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * بوابة القبول — FR-13 / مخطط 6.4 جزء أ.
 * طلب أونلاين ما بينقبل قبل تأكيد الدفع. الإجراء الوحيد المتاح قبلها: الإلغاء.
 */
export function canAcceptOrder(o: {
  paymentMethod: "online" | "cash";
  paymentStatus: PaymentStatus;
}): boolean {
  return o.paymentMethod !== "online" || o.paymentStatus === "paid";
}

export const CANNOT_ACCEPT_REASON_AR = "لا يمكن قبول الطلب قبل تأكيد الدفع";
