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
 * رأس القائمة — **كلمة واحدة، والتعليم كله بالذيل.**
 *
 * القائمة بتنبعت **نصا مرقّما عاديا**، مش رسالة قائمة تفاعلية من ميتا: القوائم
 * التفاعلية محدودة بعشرة صفوف لكل قسم وقائمة المطعم بتتجاوزها، والنص المرقّم
 * بيشتغل على كل عميل واتساب بلا استثناء.
 *
 * 🔴 كان «القائمة — أرسل رقم الصنف الذي تريده.»، فصار الزبون يقرأ نفس التعليمة
 *    مرتين برسالة وحدة: مرة بالرأس ومرة بالذيل. تقسيم التعليم بين رأس وذيل هو
 *    اللي ولّد التكرار — فالتعليم كله انتقل للذيل، وهو أسفل الرسالة حيث عين
 *    الزبون قبل ما يرد. بريف السلّة §11.6-ج.
 */
export const MENU_HEADER_AR = "القائمة";

/**
 * ذيل رسالة القائمة — الأوامر الأربعة، **مرة واحدة في الجلسة كلها**.
 *
 * 🔴 أربعة، لا خمسة. `شيل` **ما بتدخل هون** — خامس أمر بيحوّل التذكرة لورقة
 *    تعليمات. بتتعلّم بذيل عرض السلّة، قدّام زبون عم يبصّ على سلّته فعلا.
 *    بريف السلّة §12.3-أ.
 *
 * 🔴 ومرّتان اثنتان بالجلسة كلها ولا مرة ثالثة: هالذيل مرة، وتذكير «تم» على
 *    تأكيد الصنف الأول مرة. القرار 1 حسم سطرا واحدا بعد كل إضافة تجنّبا
 *    للضجيج، وتلميح على كل تأكيد بيعيد مضاعفته.
 */
export const MENU_COMMANDS_TAIL_AR =
  "اكتب رقم الصنف · «منيو» · «سلة» · «تم» لما تخلص";

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

// ---------------------------------------------------------------------------
// نصوص السلّة — بريف السلّة §5، وما أُضيف عليه بعده.
// ---------------------------------------------------------------------------

/** خانة الكمية المرفوضة. مصدّرة عشان ما حدا يكتب النص الحرفي. */
export const QUANTITY_SLOT = "[الكمية]";

/**
 * كمية فوق سقف الصنف الواحد (`MAX_QTY_PER_ITEM`).
 *
 * النص من محمد حرفيا (18 سبتمبر). **الـ50 مكتوبة بالنص نفسه**، مش مولَّدة من
 * الثابت — النص بيُنسخ كما هو. اختبار بـ`item-parser.test.mts` بيربطهم: لو
 * تغيّر السقف وما تغيّر النص، الزبون بينقال له حد غلط.
 *
 * `[الكمية]` = **مجموع** الصنف بعد التجميع، مش آخر رقم كتبه الزبون: السقف
 * على المجموع، فالرقم اللي بينقال له هو اللي انرفض فعلا.
 */
export const QTY_OVER_CAP_AR = `الكمية ${QUANTITY_SLOT} أكثر من الحد. الأقصى 50 للصنف الواحد.`;

/** `QTY_OVER_CAP_AR` بالكمية اللي كتبها الزبون. `String` بتعطي أرقاما غربية. */
export function qtyOverCapMessageAr(requestedQty: number): string {
  return QTY_OVER_CAP_AR.replace(QUANTITY_SLOT, String(requestedQty));
}

// ---------------------------------------------------------------------------
// نصوص السلّة — ب-4. حرفيا من بريف السلّة §5 و§12.3 و§14.
//
// 🔴 قاعدة نحوية لكل نص فيه اسم صنف (§14.6): **الاسم لا يكون فاعلا أبدا.**
//    أسماء الأطباق مختلطة الجنس — «كبسة لحم غير متوفر» غلط و«منسف غير
//    متوفرة» غلط، وولا صيغة بتصلح للاتنين. دايما «الصنف [الاسم] …» — «الصنف»
//    مذكّر وهو اللي بيحمل الخبر. أو الاسم بقائمة: «[الاسم] ×[الكمية]».
//    اختبار حراسة بـ`test/cart-texts.test.mts` بيفحص كل موضع للخانة.
// ---------------------------------------------------------------------------

export const ITEM_NAME_SLOT = "[الاسم]";
export const TOTAL_SLOT = "[المجموع]";
export const LINE_PRICE_SLOT = "[سعر السطر]";
export const MENU_NUMBER_SLOT = "[رقم المنيو]";
export const NUMBER_SLOT = "[الرقم]";
/** `N` = عدد مفاتيح `menu_map` — لا عدد الأصناف بالقاعدة (§4). */
export const LAST_MENU_NUMBER_SLOT = "[آخر رقم]";
export const PART_SLOT = "[النص]";
/** قيم متعددة بسطر واحد، مفصولة بـ«، » — صيغ الجمع (§14.4). */
export const VALUES_SLOT = "[القيم]";
export const RESTAURANT_PHONE_SLOT = "[رقم المطعم]";

/** إضافة صنف واحد. `[المجموع]` = مجموع **السلّة**، لا مجموع السطر. */
export const ITEM_ADDED_AR = `أضفت: ${ITEM_NAME_SLOT} ×${QUANTITY_SLOT} — المجموع ${TOTAL_SLOT} د.أ`;
/** إضافة أكثر من صنف: رأس، وسطر لكل صنف، ثم سطر المجموع. */
export const ITEMS_ADDED_HEADER_AR = "أضفت:";
export const ITEMS_ADDED_LINE_AR = `${ITEM_NAME_SLOT} ×${QUANTITY_SLOT}`;
/** سطر المجموع — نفسه بالإضافة المتعددة وبعرض السلّة. */
export const CART_TOTAL_LINE_AR = `المجموع ${TOTAL_SLOT} د.أ`;

/**
 * تذكير الإنهاء — **على تأكيد الصنف الأول وحده**. مع ذيل المنيو: مرّتان
 * اثنتان بالجلسة كلها، ولا مرة ثالثة (§2).
 */
export const FINISH_HINT_AR = "اكتب «تم» لإنهاء الطلب.";

export const UNKNOWN_NUMBER_AR = `الرقم ${NUMBER_SLOT} غير موجود في المنيو. الأرقام من 1 إلى ${LAST_MENU_NUMBER_SLOT}.`;
export const UNKNOWN_NUMBERS_AR = `الأرقام ${VALUES_SLOT} غير موجودة في المنيو. الأرقام من 1 إلى ${LAST_MENU_NUMBER_SLOT}.`;
/** جمع `QTY_OVER_CAP_AR`. الـ50 مكتوبة بالنص، واختبار بيربطها بالثابت. */
export const QTYS_OVER_CAP_AR = `الكميات ${VALUES_SLOT} أكثر من الحد. الأقصى 50 للصنف الواحد.`;
export const UNCLEAR_PART_AR = `الجزء «${PART_SLOT}» غير واضح — الطلب بالأرقام فقط.`;
export const UNCLEAR_PARTS_AR = `الأجزاء ${VALUES_SLOT} غير واضحة — الطلب بالأرقام فقط.`;
/** رسالة ما تعرّفنا فيها على ولا صنف حقيقي (`unparsed`). */
export const NOTHING_UNDERSTOOD_AR = `الأرقام من 1 إلى ${LAST_MENU_NUMBER_SLOT}. اكتب «منيو» لعرض القائمة.`;

/**
 * صنف صار غير متوفر بعد إرسال المنيو (§14.5). **مش «غير موجود في المنيو»** —
 * هاداك كاذب هون، فالصنف بالمنيو اللي بيشوفه الزبون.
 */
export const ITEM_UNAVAILABLE_AR = `الصنف ${ITEM_NAME_SLOT} غير متوفر الآن.`;
/** «شيل» على صنف بالمنيو مش بالسلّة (§14.3). سطر لحاله — السلّة ما تغيّرت. */
export const ITEM_NOT_IN_CART_AR = `الصنف ${ITEM_NAME_SLOT} غير موجود في سلّتك.`;

export const CART_HEADER_AR = "سلّتك:";
/**
 * سطر السلّة **برقم المنيو** (§12.3-ب). بلاه «شيل 2» ملتبسة: رقم منيو ولا
 * ترتيب السطر؟ والالتباس بيحذف الصنف الغلط بلا ولا رسالة خطأ.
 */
export const CART_LINE_AR = `${MENU_NUMBER_SLOT} · ${ITEM_NAME_SLOT} ×${QUANTITY_SLOT} — ${LINE_PRICE_SLOT} د.أ`;
/**
 * ⚠️ صنف بالسلّة وما عاد إله رقم بالخريطة — إعادة «منيو» بعد ما انخفى. نفس
 * السطر بلا بادئة الرقم: ما في رقم صادق نعرضه. فجوة معروفة (§14.8).
 */
export const CART_LINE_UNNUMBERED_AR = `${ITEM_NAME_SLOT} ×${QUANTITY_SLOT} — ${LINE_PRICE_SLOT} د.أ`;
/** ذيل عرض السلّة — المكان الوحيد اللي بيعلّم «شيل» (§12.3-أ). */
export const CART_REMOVE_HINT_AR = "لحذف صنف: «شيل» ورقمه";
export const CART_EMPTY_AR = "سلّتك فارغة. اكتب رقم الصنف من المنيو.";
/**
 * «تم» والسلّة فارغة (§5) — نص تاني غير نص «سلة» الفارغة، وهاد مقصود بالبريف:
 * هون الزبون حاول **ينهي** طلبا ما بلّشه، فالجملة بتدلّه على البداية.
 * **ولا انتقال ولا CAS** — الجلسة بتضل `browsing` (ب-5).
 */
export const CART_EMPTY_ON_FINISH_AR =
  "سلّتك فارغة — اكتب رقم الصنف من المنيو لتبدأ.";

/**
 * رسالة الاستسلام — مرة واحدة بالجلسة. `contact_phone` = NULL يعني **ولا
 * رسالة إطلاقا**، لا نص بديل (§11.3).
 */
export const HANDOFF_AR = `للطلب مباشرة: ${RESTAURANT_PHONE_SLOT}`;

/**
 * كل قوالب نصوص السلّة — للحراسة: الممنوعات، والأرقام الغربية، والنص inline،
 * والقاعدة النحوية. قالب جديد بيدخل هون، وإلا ما بتحرسه ولا بوابة.
 */
export const CART_TEXT_TEMPLATES_AR: readonly string[] = [
  ITEM_ADDED_AR,
  ITEMS_ADDED_HEADER_AR,
  ITEMS_ADDED_LINE_AR,
  CART_TOTAL_LINE_AR,
  FINISH_HINT_AR,
  UNKNOWN_NUMBER_AR,
  UNKNOWN_NUMBERS_AR,
  QTY_OVER_CAP_AR,
  QTYS_OVER_CAP_AR,
  UNCLEAR_PART_AR,
  UNCLEAR_PARTS_AR,
  NOTHING_UNDERSTOOD_AR,
  ITEM_UNAVAILABLE_AR,
  ITEM_NOT_IN_CART_AR,
  CART_HEADER_AR,
  CART_LINE_AR,
  CART_LINE_UNNUMBERED_AR,
  CART_REMOVE_HINT_AR,
  CART_EMPTY_AR,
  CART_EMPTY_ON_FINISH_AR,
  HANDOFF_AR,
];

// --- المال: قروش أعدادا صحيحة، والقسمة على 100 عند العرض وبس (§11.6-أ) -----

/**
 * `numeric(12,2)` كما بترجع من pg (سترنغ بمنزلتين) → قروش، عدد صحيح.
 * `Math.round` بتمسح خطأ الـfloat الوحيد بالطريق: `6.30 * 100` = 629.999….
 */
export function priceToMinor(price: string): number {
  return Math.round(Number.parseFloat(price) * 100);
}

/**
 * قروش → نص العرض بمنزلتين. **القسمة الوحيدة على 100 بالنظام كله.**
 * `toFixed` بترجّع أرقاما غربية دايما — لا `toLocaleString` (§11.5).
 */
export function formatMinor(minor: number): string {
  return (minor / 100).toFixed(2);
}

/**
 * بيعبّي كل الخانات **بمرور واحد**.
 *
 * 🔴 مش `replace` متتالية: اسم صنف فيه `[الكمية]` كان بيتعبّى بالخطوة الجاية،
 *    واسم فيه `$&` كان بيفسّره `String.replace` كنمط. المرور الواحد بدالة
 *    استبدال بيحط كل قيمة مرة وحدة وحرفيا.
 */
function fillSlots(template: string, values: Record<string, string>): string {
  return template.replace(/\[[^\]]+\]/gu, (slot) => values[slot] ?? slot);
}

const joinValues = (values: readonly (string | number)[]): string =>
  values.map(String).join("، ");

/** سطر الإضافة — صنف واحد بسطر، أو رأس + أسطر + مجموع. فاضي لو ما انضاف شي. */
export function itemsAddedLinesAr(
  added: readonly { name: string; qty: number }[],
  cartTotalMinor: number,
): string[] {
  const total = formatMinor(cartTotalMinor);
  if (added.length === 0) return [];
  if (added.length === 1) {
    const [only] = added;
    return [
      fillSlots(ITEM_ADDED_AR, {
        [ITEM_NAME_SLOT]: only!.name,
        [QUANTITY_SLOT]: String(only!.qty),
        [TOTAL_SLOT]: total,
      }),
    ];
  }
  return [
    ITEMS_ADDED_HEADER_AR,
    ...added.map((a) =>
      fillSlots(ITEMS_ADDED_LINE_AR, {
        [ITEM_NAME_SLOT]: a.name,
        [QUANTITY_SLOT]: String(a.qty),
      }),
    ),
    fillSlots(CART_TOTAL_LINE_AR, { [TOTAL_SLOT]: total }),
  ];
}

export function unknownNumbersLineAr(
  numbers: readonly number[],
  lastMenuNumber: number,
): string {
  return numbers.length === 1
    ? fillSlots(UNKNOWN_NUMBER_AR, {
        [NUMBER_SLOT]: String(numbers[0]),
        [LAST_MENU_NUMBER_SLOT]: String(lastMenuNumber),
      })
    : fillSlots(UNKNOWN_NUMBERS_AR, {
        [VALUES_SLOT]: joinValues(numbers),
        [LAST_MENU_NUMBER_SLOT]: String(lastMenuNumber),
      });
}

export function overCapLineAr(quantities: readonly number[]): string {
  return quantities.length === 1
    ? qtyOverCapMessageAr(quantities[0]!)
    : fillSlots(QTYS_OVER_CAP_AR, { [VALUES_SLOT]: joinValues(quantities) });
}

export function unclearPartsLineAr(parts: readonly string[]): string {
  return parts.length === 1
    ? fillSlots(UNCLEAR_PART_AR, { [PART_SLOT]: parts[0]! })
    : fillSlots(UNCLEAR_PARTS_AR, {
        [VALUES_SLOT]: joinValues(parts.map((p) => `«${p}»`)),
      });
}

export function nothingUnderstoodAr(lastMenuNumber: number): string {
  return fillSlots(NOTHING_UNDERSTOOD_AR, {
    [LAST_MENU_NUMBER_SLOT]: String(lastMenuNumber),
  });
}

export function itemUnavailableAr(name: string): string {
  return fillSlots(ITEM_UNAVAILABLE_AR, { [ITEM_NAME_SLOT]: name });
}

export function itemNotInCartAr(name: string): string {
  return fillSlots(ITEM_NOT_IN_CART_AR, { [ITEM_NAME_SLOT]: name });
}

export interface CartDisplayLine {
  /** رقم الصنف بالخريطة **الحالية**. `null` لو ما عاد إله رقم. */
  readonly menuNumber: number | null;
  readonly name: string;
  readonly qty: number;
  readonly lineTotalMinor: number;
}

/**
 * عرض السلّة كاملة، أو نص السلّة الفارغة.
 *
 * `removeHint: false` عند `cart_review`: «شيل» بتشتغل بالتصفّح وبس، وتعليم
 * أمر ما عاد يشتغل أسوأ من عدم تعليمه — والتعديل عند `cart_review` مرفوض
 * (§12.2)، فما في بديل نعلّمه هون.
 */
export function cartMessageAr(
  lines: readonly CartDisplayLine[],
  cartTotalMinor: number,
  options: { readonly removeHint?: boolean } = {},
): string {
  if (lines.length === 0) return CART_EMPTY_AR;
  return [
    CART_HEADER_AR,
    ...lines.map((l) =>
      fillSlots(
        l.menuNumber === null ? CART_LINE_UNNUMBERED_AR : CART_LINE_AR,
        {
          [MENU_NUMBER_SLOT]: String(l.menuNumber),
          [ITEM_NAME_SLOT]: l.name,
          [QUANTITY_SLOT]: String(l.qty),
          [LINE_PRICE_SLOT]: formatMinor(l.lineTotalMinor),
        },
      ),
    ),
    fillSlots(CART_TOTAL_LINE_AR, {
      [TOTAL_SLOT]: formatMinor(cartTotalMinor),
    }),
    ...(options.removeHint === false ? [] : [CART_REMOVE_HINT_AR]),
  ].join("\n");
}

export function handoffMessageAr(contactPhone: string): string {
  return fillSlots(HANDOFF_AR, { [RESTAURANT_PHONE_SLOT]: contactPhone });
}
