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

// ---------------------------------------------------------------------------
// نصوص محادثة الواتساب — بوابة ساعات الدوام وأول رد.
//
// 🔴 المصدر الوحيد لأي نص عربي بيوصل الزبون. ممنوع كتابة أي وحدة منهم inline
//    بمحرّك المحادثة، ولا إعادة صياغتها بمكان النداء.
//
// قيود بتنطبق على كل نص هون، وبتنكسر بسهولة لما حدا يضيف نصا جديدا مستعجلا:
//   - أرقام غربية فقط (0-9). بوابة check:numerals بتفحصها.
//   - عربية سليمة بمفردات طبيعية، بلا لهجة محلية محدّدة.
//   - ممنوع: عم · هلق · شو · بدي · رح · يُرجى · نأسف لإبلاغكم · قم بـ ·
//     انقر هنا · تم بنجاح.
//   - الفاعل هو المطعم، مش النظام: «نستقبل الطلبات»، مش «النظام يستقبل».
//   - لا تكرّر كلمة الشارة جوّا رسالة الزبون — الشارات بـORDER_STATUS_LABEL_AR
//     مفردة تانية بالكامل، نفس القاعدة اللي فوق بالضبط.
// ---------------------------------------------------------------------------

/** الخانات اللي بتنستبدل قبل الإرسال. مصدّرة عشان ما حدا يكتب النص الحرفي. */
export const RESTAURANT_NAME_SLOT = "[اسم المطعم]";
export const OPENS_AT_SLOT = "[من]";
export const CLOSES_AT_SLOT = "[إلى]";

/**
 * بوابة ساعات الدوام — FR-22. مطعم مغلق ما بتنفتح إله جلسة.
 *
 * صيغتان، والاختيار بينهم مش تجميلي:
 *   - `CLOSED_WITH_HOURS_AR` بترجّع للزبون **اللي أدخله المطعم بنفسه**. لو
 *     البيانات غلط، المطعم بيشوف غلطه ظاهرا قدّام الزبون.
 *   - `CLOSED_AR` لما أوقات اليوم ما بتنقرأ: الحقل فاضي، أو اليوم مغلق كليا،
 *     أو الـjsonb ما انفحص.
 *
 * 🔴 ولا وحدة منهم بتوعد بوقت فتح **محسوب**. «بنفتح الساعة كذا» بتتطلب حساب
 *    بقية اليوم أو الغد أو أول يوم عمل جاي، مع الإغلاق بعد منتصف الليل واليوم
 *    المغلق كليا — وأي غلط بالحساب بيصير وعدا مكسورا. نفس سبب تأجيل «الوقت
 *    المتوقع»: التقدير الغلط أسوأ من لا تقدير.
 */
export const CLOSED_AR = "المطعم مغلق حاليا.";
export const CLOSED_WITH_HOURS_AR = `المطعم مغلق حاليا. نستقبل الطلبات من ${OPENS_AT_SLOT} إلى ${CLOSES_AT_SLOT}.`;

/** أول رد على زبون بلا جلسة نشطة. اسم المطعم من صف restaurants. */
export const WELCOME_AR = `أهلا بك في ${RESTAURANT_NAME_SLOT}.`;

/**
 * رأس القائمة.
 *
 * القائمة بتنبعت **نصا مرقّما عاديا**، مش رسالة قائمة تفاعلية من ميتا: القوائم
 * التفاعلية محدودة بعشرة صفوف لكل قسم وقائمة المطعم بتتجاوزها، والنص المرقّم
 * بيشتغل على كل عميل واتساب بلا استثناء.
 */
export const MENU_HEADER_AR = "القائمة — أرسل رقم الصنف الذي تريده.";

/** `CLOSED_WITH_HOURS_AR` بخاناتها مستبدلة. بترجّع `CLOSED_AR` لو ما في أوقات. */
export function closedMessageAr(
  window: {
    opensAt: string;
    closesAt: string;
  } | null,
): string {
  if (window === null) return CLOSED_AR;
  return CLOSED_WITH_HOURS_AR.replace(OPENS_AT_SLOT, window.opensAt).replace(
    CLOSES_AT_SLOT,
    window.closesAt,
  );
}

/** `WELCOME_AR` باسم المطعم مستبدلا. */
export function welcomeMessageAr(restaurantName: string): string {
  return WELCOME_AR.replace(RESTAURANT_NAME_SLOT, restaurantName);
}
