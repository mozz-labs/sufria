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
 * مرآة `restaurants_currency_check` بـ0011 — عملة المطعم (بريف د §2.2).
 * الأردن سوق الإطلاق فالافتراضي بالقاعدة `JOD`، ومطعم البايلوت التشغيلي
 * بغزة `ILS`.
 */
export const CURRENCIES = ["JOD", "ILS"] as const;
export type Currency = (typeof CURRENCIES)[number];

/**
 * تسمية العملة كما بتنكتب جنب كل مبلغ بيوصل الزبون (بريف د §2.2).
 *
 * 🔴 **بتدخل القوالب خانةً `[العملة]`، مش ملزوقة بالمنسّق** (§8.4):
 *    `formatMinor` بترجّع الرقم وحده زي ما كانت، والقالب بيضل جملة عربية
 *    كاملة بيقرأها إنسان ويراجعها.
 */
export const CURRENCY_LABEL_AR: Record<Currency, string> = {
  JOD: "د.أ",
  ILS: "شيكل",
};

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
 * رقم الطلب برسالة «استلمنا» (بريف د §2.1) — مصدّرة لنفس السبب. بتنعبّى من
 * `orders.order_number` المخزَّن، لا من رقم محسوب بمكان تاني.
 */
export const ORDER_NUMBER_SLOT = "[رقم الطلب]";

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
  /**
   * الاستلام: أول رد بعد ما بينحفظ الطلب، قبل ما المطعم يشوفه.
   * 🔴 **بالرقم** (بريف د §2.1): الزبون بيوصل المطعم وبيقول شي، والموظف
   *    بيدوّر بشي. بتنبعت عبر `orderReceivedMessageAr` وحدها — القالب الخام
   *    فيه الخانة.
   */
  pending_acceptance: `استلمنا طلبك رقم ${ORDER_NUMBER_SLOT} — التأكيد خلال دقائق.`,
  accepted: "أكّدنا طلبك.",
  /**
   * 🔴 يتفرّع حسب `fulfillment_type` (ج §2.7) — و**الشكل المتفرّع هو الحارس**:
   *    النوع نفسه يمنع إرسال «طلبك جاهز للاستلام.» لطلب توصيل. ثابت شقيق
   *    بجانبه كان سيسمح بذلك ويمرّ في الترجمة بلا شكوى.
   *
   *    و«طلبك جاهز» وحدها ممنوعة: **الرسالة لا تعيد كلمة الشارة.**
   */
  ready: {
    pickup: "طلبك جاهز للاستلام.",
    delivery: "طلبك خرج للتوصيل.",
  },
  /** بيتفرّع حسب `cancelled_by` — مين ألغى بيغيّر الجملة، مش بس السبب. */
  cancelled: {
    restaurant: `ألغينا طلبك — ${ORDER_CANCELLATION_REASON_SLOT}.`,
    /**
     * إلغاء المطعم **بلا سبب** (بريف و §1.1، قرار 26 سبتمبر). `restaurant`
     * بخانة فارغة كانت بتطلع «ألغينا طلبك — .» أو الخانة نفسها للزبون.
     */
    restaurant_no_reason: "ألغينا طلبك.",
    customer: "ألغينا الطلب حسب طلبك.",
  },
} as const;

/**
 * The whole order state machine — staff and system transitions together
 * (FR-13), including `ready → expired`, which only the system makes.
 *
 * 🔴 Not what the dashboard uses. `dashboard-api` validates against
 *    `STAFF_TRANSITIONS` (`dashboard-api.ts`), and the screen must disable its
 *    buttons by that table too; a `shared` test holds it to be a subset of
 *    this one. Nothing validates against this table today — it is the full
 *    map the system-side transitions (`expired`, Sprint 2) will check.
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

/**
 * بيعبّي كل الخانات **بمرور واحد** — لكل نص بالملف، لا لنصوص السلّة وحدها.
 *
 * 🔴 مش `replace` متتالية، ولا `replace` واحدة ببديل نصي:
 *    - قيمة فيها `$&` بيفسّرها `String.replace` **نمطا**، فبتحط محله اسم
 *      الخانة نفسها: مطعم اسمه `مطعم $&` بيصير `مطعم [اسم المطعم]` برسالة الترحيب.
 *    - وقيمة فيها خانة تانية بتتعبّى بالخطوة الجاية.
 *    المرور الواحد بدالة استبدال بيحط كل قيمة مرة وحدة وحرفيا.
 *
 * والقيمتان اللي بتيجيا من برّا حقيقيتان: اسم المطعم بيكتبه المطعم، واسم
 * الصنف كذلك — ولا واحد فيهم ثابت بالكود.
 */
function fillSlots(template: string, values: Record<string, string>): string {
  return template.replace(/\[[^\]]+\]/gu, (slot) => values[slot] ?? slot);
}

/** `CLOSED_WITH_HOURS_AR` بخاناتها مستبدلة. بترجّع `CLOSED_AR` لو ما في أوقات. */
export function closedMessageAr(
  window: {
    opensAt: string;
    closesAt: string;
  } | null,
): string {
  if (window === null) return CLOSED_AR;
  return fillSlots(CLOSED_WITH_HOURS_AR, {
    [OPENS_AT_SLOT]: window.opensAt,
    [CLOSES_AT_SLOT]: window.closesAt,
  });
}

/** `WELCOME_AR` باسم المطعم مستبدلا. */
export function welcomeMessageAr(restaurantName: string): string {
  return fillSlots(WELCOME_AR, { [RESTAURANT_NAME_SLOT]: restaurantName });
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
/**
 * تسمية عملة المطعم (`CURRENCY_LABEL_AR`) — بكل قالب فيه مبلغ (بريف د §8.4).
 * 🔴 كانت «د.أ» ثابتة بالقوالب الستة، فمطعم غزة كان رح يبيع بالشيكل ويكتب
 *    للزبون دينارا.
 */
export const CURRENCY_SLOT = "[العملة]";
/** سعر الصنف الواحد بسطر المنيو — مش سعر سطر السلّة. */
export const PRICE_SLOT = "[السعر]";

/**
 * سطر المنيو (بريف د §2.3 و§8.4) — كان مكتوبا inline بـ`menu.ts` بلا عملة،
 * بينما السلّة بتقول `2.50 د.أ`. نفس الشكل القائم، والعملة بخانتها.
 * الرقم متسلسل عبر القائمة كلها، ومنه بتنكتب `menu_map`.
 */
export const MENU_LINE_AR = `${MENU_NUMBER_SLOT}. ${ITEM_NAME_SLOT} — ${PRICE_SLOT} ${CURRENCY_SLOT}`;

/** إضافة صنف واحد. `[المجموع]` = مجموع **السلّة**، لا مجموع السطر. */
export const ITEM_ADDED_AR = `أضفت: ${ITEM_NAME_SLOT} ×${QUANTITY_SLOT} — المجموع ${TOTAL_SLOT} ${CURRENCY_SLOT}`;
/** إضافة أكثر من صنف: رأس، وسطر لكل صنف، ثم سطر المجموع. */
export const ITEMS_ADDED_HEADER_AR = "أضفت:";
export const ITEMS_ADDED_LINE_AR = `${ITEM_NAME_SLOT} ×${QUANTITY_SLOT}`;
/** سطر المجموع — نفسه بالإضافة المتعددة وبعرض السلّة. */
export const CART_TOTAL_LINE_AR = `المجموع ${TOTAL_SLOT} ${CURRENCY_SLOT}`;

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
/**
 * جمع `ITEM_UNAVAILABLE_AR` — صنفان فأكثر بسطر واحد (§14.4).
 *
 * 🔴 «الأصناف» هي الفاعل، لا الأسماء. جمع غير العاقل يُعامَل مؤنثا مفردا،
 *    فـ«غير متوفرة» بتتفق مع أي خليط أطباق — نفس سبب «الصنف» بالمفرد (§14.6).
 *    وبدونه كان سطران لصنفين، وهي الفجوة #1 المسجّلة بـ§14.8.
 */
export const ITEMS_UNAVAILABLE_AR = `الأصناف ${VALUES_SLOT} غير متوفرة الآن.`;
/**
 * صنف كان **بالسلّة** وما عاد متوفرا لحظة كتابة خريطة جديدة (§16).
 *
 * 🔴 مش `ITEM_UNAVAILABLE_AR`، والفرق مقصود: هاداك **بيرفض إضافة**
 *    طلبها الزبون هلأ، وهاد **بيخبّر عن حذف صار** بلا ما يطلب الزبون إشي.
 *    خلطهم بيخلّي الزبون يقرأ «غير متوفر الآن» وما يعرف إن سلّته نقصت.
 */
export const ITEM_REMOVED_UNAVAILABLE_AR = `الصنف ${ITEM_NAME_SLOT} لم يعد متوفرا وحُذف من سلّتك.`;
/** جمعه — **سطر واحد جوّا نفس الرسالة**، لا رسالة لكل صنف. */
export const ITEMS_REMOVED_UNAVAILABLE_AR = `الأصناف ${VALUES_SLOT} لم تعد متوفرة وحُذفت من سلّتك.`;

/** «شيل» على صنف بالمنيو مش بالسلّة (§14.3). سطر لحاله — السلّة ما تغيّرت. */
export const ITEM_NOT_IN_CART_AR = `الصنف ${ITEM_NAME_SLOT} غير موجود في سلّتك.`;

export const CART_HEADER_AR = "سلّتك:";
/**
 * سطر السلّة **برقم المنيو** (§12.3-ب). بلاه «شيل 2» ملتبسة: رقم منيو ولا
 * ترتيب السطر؟ والالتباس بيحذف الصنف الغلط بلا ولا رسالة خطأ.
 */
export const CART_LINE_AR = `${MENU_NUMBER_SLOT} · ${ITEM_NAME_SLOT} ×${QUANTITY_SLOT} — ${LINE_PRICE_SLOT} ${CURRENCY_SLOT}`;
/**
 * ⚠️ صنف بالسلّة وما عاد إله رقم بالخريطة — إعادة «منيو» بعد ما انخفى. نفس
 * السطر بلا بادئة الرقم: ما في رقم صادق نعرضه. فجوة معروفة (§14.8).
 */
export const CART_LINE_UNNUMBERED_AR = `${ITEM_NAME_SLOT} ×${QUANTITY_SLOT} — ${LINE_PRICE_SLOT} ${CURRENCY_SLOT}`;
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

// ---------------------------------------------------------------------------
// ما بعد السلّة — طريقة الاستلام، والعنوان، والملخّص (ج §6)
// ---------------------------------------------------------------------------

/** رسوم التوصيل، رقما جاهزا للعرض. العملة بخانتها جنبه (`[العملة]`). */
export const FEE_SLOT = "[الرسوم]";
/** عنوان التوصيل **كما كتبه الزبون**. يُعرض كما هو، بلا تطبيع (ج §0). */
export const ADDRESS_SLOT = "[العنوان]";

/**
 * 🔴 كل رسالة سؤال تقول حرفيا ماذا يكتب الزبون (ج §2.3).
 *    المحلّل صارم — «تمام خلينا نكمل» لا تطابق شيئا — و**الصرامة بلا توجيه
 *    حلقة لا تنتهي**: الزبون يكتب، فلا يُفهم، فيُعاد عليه السؤال نفسه بلا
 *    أي دليل على ما يُقبل. السطر التالي هو الدليل، ولهذا يتكرّر في الثلاثة.
 */
export const FULFILLMENT_PROMPT_AR = "اكتب «استلام» أو «توصيل».";

const FULFILLMENT_QUESTION_AR = "استلام من المطعم أو توصيل؟";
/** سؤال الاستلام حين للمطعم رسوم توصيل: الرقم يُقال **قبل** أن يختار. */
export const FULFILLMENT_ASK_WITH_FEE_AR = `${FULFILLMENT_QUESTION_AR} رسوم التوصيل ${FEE_SLOT} ${CURRENCY_SLOT}.\n${FULFILLMENT_PROMPT_AR}`;
/** ورسوم صفر: لا سطر رسوم إطلاقا، لا «0.00 د.أ» — الصفر ليس معلومة هنا. */
export const FULFILLMENT_ASK_NO_FEE_AR = `${FULFILLMENT_QUESTION_AR}\n${FULFILLMENT_PROMPT_AR}`;

/** طلب العنوان — رسالة واحدة، والثلاثة المطلوبة مسمّاة فيها. */
export const ADDRESS_ASK_AR =
  "اكتب عنوان التوصيل في رسالة واحدة: المنطقة والشارع ورقم البناية.";
/** الـ300 مكتوبة بالنص، واختبار يربطها بـ`MAX_ADDRESS_LENGTH` (نمط §13.1). */
export const ADDRESS_TOO_LONG_AR =
  "العنوان أطول من 300 حرف. اكتبه في رسالة أقصر.";
/** سقف العنوان — نفس الحد الذي يفرضه `orders_delivery_has_address` في 0010. */
export const MAX_ADDRESS_LENGTH = 300;

/** ذيل الملخّص، وردّ `cart_review` على أي رسالة غير مطابقة. */
export const CONFIRM_PROMPT_AR =
  "اكتب «أكّد» لإرسال الطلب، أو «عدّل» أو «ألغِ».";

/**
 * الإلغاء **قبل** إنشاء الطلب. الجلسة ترجع `browsing` بسلّة فارغة و`menu_map`
 * صالحة، فالسطر الثاني مسار حقيقي: رقم الصنف يعمل فورا بلا «منيو» (ج §3).
 */
export const ORDER_CANCELLED_AR =
  "ألغينا طلبك. لطلب جديد اكتب رقم الصنف أو «منيو».";

export const SUMMARY_HEADER_AR = "ملخّص طلبك:";
/** سطر الرسوم — **للتوصيل برسوم > 0 وحده** (ج §6). */
export const SUMMARY_FEE_LINE_AR = `التوصيل — ${FEE_SLOT} ${CURRENCY_SLOT}`;
export const SUMMARY_PICKUP_LINE_AR = "الاستلام من المطعم";
export const SUMMARY_DELIVERY_LINE_AR = `التوصيل إلى: ${ADDRESS_SLOT}`;
/**
 * طريقة دفع واحدة في البايلوت، فلا سؤال عنها — سطر خبري يكفي (ج §2.5).
 * 🔴 «الدفع نقدا.» لا «… عند الاستلام.» (بريف د §2.4)، للاستلام والتوصيل:
 *    في طلب الاستلام يأتي مباشرة بعد «الاستلام من المطعم» فتتكرّر الكلمة.
 */
export const SUMMARY_PAYMENT_LINE_AR = "الدفع نقدا.";

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
  ITEMS_UNAVAILABLE_AR,
  ITEM_REMOVED_UNAVAILABLE_AR,
  ITEMS_REMOVED_UNAVAILABLE_AR,
  ITEM_NOT_IN_CART_AR,
  CART_HEADER_AR,
  CART_LINE_AR,
  CART_LINE_UNNUMBERED_AR,
  CART_REMOVE_HINT_AR,
  CART_EMPTY_AR,
  CART_EMPTY_ON_FINISH_AR,
  HANDOFF_AR,
  // سطر المنيو مش نص سلّة، بس هون بيدخل الحراسة — وبينطبق عليه اللي فوق.
  MENU_LINE_AR,
];

/** قوالب ما بعد السلّة (ج §6) — تدخل نفس الحراسة، وإلا لم يحرسها شيء. */
export const ORDER_TEXT_TEMPLATES_AR: readonly string[] = [
  FULFILLMENT_PROMPT_AR,
  FULFILLMENT_ASK_WITH_FEE_AR,
  FULFILLMENT_ASK_NO_FEE_AR,
  ADDRESS_ASK_AR,
  ADDRESS_TOO_LONG_AR,
  CONFIRM_PROMPT_AR,
  ORDER_CANCELLED_AR,
  SUMMARY_HEADER_AR,
  SUMMARY_FEE_LINE_AR,
  SUMMARY_PICKUP_LINE_AR,
  SUMMARY_DELIVERY_LINE_AR,
  SUMMARY_PAYMENT_LINE_AR,
];

/**
 * رسائل الحالة، مسطّحة — `ORDER_STATUS_MESSAGE_AR` متداخلة، والحارس يمشي على
 * نصوص لا على شجرة.
 */
export const ORDER_STATUS_TEXTS_AR: readonly string[] = [
  ORDER_STATUS_MESSAGE_AR.pending_acceptance,
  ORDER_STATUS_MESSAGE_AR.accepted,
  ORDER_STATUS_MESSAGE_AR.ready.pickup,
  ORDER_STATUS_MESSAGE_AR.ready.delivery,
  ORDER_STATUS_MESSAGE_AR.cancelled.restaurant,
  ORDER_STATUS_MESSAGE_AR.cancelled.restaurant_no_reason,
  ORDER_STATUS_MESSAGE_AR.cancelled.customer,
];

/**
 * **كل نص يصل الزبون**، وهو ما تمشي عليه الحراسة فعلا (ج §15.6).
 *
 * 🔴 §0 من بريف ج ادّعى أن القاموس المحروس يورّث «حراسات الأرقام والممنوعات».
 *    الواقع حارسان اثنان: الأرقام العربية-الهندية، واسم الصنف ليس فاعلا.
 *    **لا حارس للممنوعات اللهجية** — فحصها يدوي، وبوابته مهمة مستقلة بعد ج.
 *    ولا تُقرأ هذه القائمة على أنها تحرس أكثر مما تحرس.
 *
 *    و`ORDER_STATUS_MESSAGE_AR` كانت خارج الحراسة كليا حتى الآن: «استلمنا
 *    طلبك» شُحنت بلا أن يفحصها شيء.
 */
export const ALL_CUSTOMER_TEXTS_AR: readonly string[] = [
  ...CART_TEXT_TEMPLATES_AR,
  ...ORDER_TEXT_TEMPLATES_AR,
  ...ORDER_STATUS_TEXTS_AR,
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

const joinValues = (values: readonly (string | number)[]): string =>
  values.map(String).join("، ");

/**
 * خانة العملة لـ`fillSlots`. 🔴 **العملة باراميتر إجباري بكل دالة فيها مبلغ**،
 * مش اختياري بافتراضي `JOD`: مسار بينسى يمرّرها لازم يوقف بالـtypecheck، مش
 * يبعت «د.أ» لمطعم غزة بصمت.
 */
const currencySlot = (currency: Currency): Record<string, string> => ({
  [CURRENCY_SLOT]: CURRENCY_LABEL_AR[currency],
});

/**
 * سطر المنيو بعملة المطعم (بريف د §8.4). السعر **بالقروش** ويمرّ بـ`formatMinor`
 * نفسها — مش `Number(price).toFixed(2)`، اللي هو تحويل مال بالـJS.
 */
export function menuLineAr(
  line: {
    readonly number: number;
    readonly name: string;
    readonly priceMinor: number;
  },
  currency: Currency,
): string {
  return fillSlots(MENU_LINE_AR, {
    [MENU_NUMBER_SLOT]: String(line.number),
    [ITEM_NAME_SLOT]: line.name,
    [PRICE_SLOT]: formatMinor(line.priceMinor),
    ...currencySlot(currency),
  });
}

/** سطر الإضافة — صنف واحد بسطر، أو رأس + أسطر + مجموع. فاضي لو ما انضاف شي. */
export function itemsAddedLinesAr(
  added: readonly { name: string; qty: number }[],
  cartTotalMinor: number,
  currency: Currency,
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
        ...currencySlot(currency),
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
    fillSlots(CART_TOTAL_LINE_AR, {
      [TOTAL_SLOT]: total,
      ...currencySlot(currency),
    }),
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

/**
 * سطر واحد لكل الأصناف غير المتوفرة بالرسالة — مفرد أو جمع.
 *
 * 🔴 سطر **واحد**، لا سطر لكل صنف: قاعدة «سطر لكل نوع مشكلة» (§14.1-1) كانت
 *    مكسورة هون عمدا لغياب نص الجمع. النص وصل، فالقاعدة رجعت.
 */
export function itemsUnavailableLineAr(names: readonly string[]): string {
  return names.length === 1
    ? fillSlots(ITEM_UNAVAILABLE_AR, { [ITEM_NAME_SLOT]: names[0]! })
    : fillSlots(ITEMS_UNAVAILABLE_AR, { [VALUES_SLOT]: joinValues(names) });
}

/**
 * سطر واحد لكل اللي انحذفوا من السلّة — مفرد أو جمع (§16).
 *
 * الأسماء من **snapshot سطر السلّة**، لا من صف الصنف: الصف قد يكون
 * انمسح كليا، والاسم المحفوظ هو اللي شافه الزبون وقت الإضافة.
 */
export function itemsRemovedUnavailableLineAr(
  names: readonly string[],
): string {
  return names.length === 1
    ? fillSlots(ITEM_REMOVED_UNAVAILABLE_AR, { [ITEM_NAME_SLOT]: names[0]! })
    : fillSlots(ITEMS_REMOVED_UNAVAILABLE_AR, {
        [VALUES_SLOT]: joinValues(names),
      });
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
  currency: Currency,
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
          ...currencySlot(currency),
        },
      ),
    ),
    fillSlots(CART_TOTAL_LINE_AR, {
      [TOTAL_SLOT]: formatMinor(cartTotalMinor),
      ...currencySlot(currency),
    }),
    ...(options.removeHint === false ? [] : [CART_REMOVE_HINT_AR]),
  ].join("\n");
}

export function handoffMessageAr(contactPhone: string): string {
  return fillSlots(HANDOFF_AR, { [RESTAURANT_PHONE_SLOT]: contactPhone });
}

/**
 * ما يحتاجه الملخّص من طريقة الاستلام.
 *
 * 🔴 العنوان هنا `string` لا `string | null`، **وهذا هو الفرق عن الشكل
 *    المخزَّن في `SessionData`** الذي يحمل `address: string | null` لأن
 *    الجلسة تمرّ بلحظة اختير فيها «توصيل» ولم يصل العنوان بعد (ج §4).
 *    الملخّص لا يُعرض إلا على `fulfillment` **مكتمل** (ج §3)، فجعل النوع
 *    يرفض الناقص يعني أن ملخّصا بلا عنوان **لا يُترجم أصلا** بدل أن يُرسَل
 *    سطرا فيه «التوصيل إلى: » وبعده فراغ.
 */
export type SummaryFulfillment =
  | { readonly type: "pickup" }
  | {
      readonly type: "delivery";
      readonly feeMinor: number;
      readonly address: string;
    };

/**
 * رسالة `cart_review` — تحلّ محل عرض السلّة الذي كانت ب-5 ترسله (ج §6).
 *
 * دالة صافية: لا تقرأ قاعدة ولا ساعة. وتأخذ **مجموع السلّة** وتحسب المجموع
 * النهائي منه ومن الرسوم — «لا تخزّن مجموعا» (ج §4)، فالرقم المعروض مشتقّ
 * دائما من نفس المدخلين اللذين يكتبهما إنشاء الطلب.
 *
 * - **أعداد صحيحة بالقروش**، والقسمة على 100 عند العرض وحده عبر `formatMinor`
 *   — المنسّق القائم، ولا منسّق ثانيا (ج §6).
 * - **بلا ذيل «شيل»**: الأمر لا يعمل في `cart_review`، وتعليم أمر معطّل أسوأ
 *   من عدم تعليمه (ب §15.1).
 * - سطر الرسوم يظهر **للتوصيل برسوم > 0 وحده**: «التوصيل — 0.00 د.أ» تقول
 *   للزبون إن هناك رسوما ثم تقول إنها صفر، وهي جملة بلا فائدة.
 */
export function buildOrderSummary(
  lines: readonly CartDisplayLine[],
  subtotalMinor: number,
  fulfillment: SummaryFulfillment,
  currency: Currency,
): string {
  const feeMinor = fulfillment.type === "delivery" ? fulfillment.feeMinor : 0;

  return [
    SUMMARY_HEADER_AR,
    ...lines.map((l) =>
      fillSlots(
        l.menuNumber === null ? CART_LINE_UNNUMBERED_AR : CART_LINE_AR,
        {
          [MENU_NUMBER_SLOT]: String(l.menuNumber),
          [ITEM_NAME_SLOT]: l.name,
          [QUANTITY_SLOT]: String(l.qty),
          [LINE_PRICE_SLOT]: formatMinor(l.lineTotalMinor),
          ...currencySlot(currency),
        },
      ),
    ),
    ...(feeMinor > 0
      ? [
          fillSlots(SUMMARY_FEE_LINE_AR, {
            [FEE_SLOT]: formatMinor(feeMinor),
            ...currencySlot(currency),
          }),
        ]
      : []),
    fillSlots(CART_TOTAL_LINE_AR, {
      [TOTAL_SLOT]: formatMinor(subtotalMinor + feeMinor),
      ...currencySlot(currency),
    }),
    fulfillment.type === "pickup"
      ? SUMMARY_PICKUP_LINE_AR
      : fillSlots(SUMMARY_DELIVERY_LINE_AR, {
          [ADDRESS_SLOT]: fulfillment.address,
        }),
    SUMMARY_PAYMENT_LINE_AR,
    CONFIRM_PROMPT_AR,
  ].join("\n");
}

/** سؤال «استلام أم توصيل؟» — الرسوم تُقال قبل الاختيار، إن كانت (ج §6). */
export function fulfillmentAskAr(feeMinor: number, currency: Currency): string {
  return feeMinor > 0
    ? fillSlots(FULFILLMENT_ASK_WITH_FEE_AR, {
        [FEE_SLOT]: formatMinor(feeMinor),
        ...currencySlot(currency),
      })
    : FULFILLMENT_ASK_NO_FEE_AR;
}

/**
 * رسالة حالة `ready` حسب طريقة الاستلام (ج §2.7).
 *
 * 🔴 **قاعدة تشغيلية تسبق هذا الكود:** في طلب التوصيل، تحويل الطلب إلى
 *    «جاهز» يعني **«سلّمناه للسائق»**، لا «خلص الطبخ». بدونها الرسالة تكذب
 *    على الزبون، ولا كود يستطيع كشف ذلك.
 *
 * الإرسال نفسه مهمة المُراقِب (FR-11) وهي خارج ج — هذا الثابت وحده.
 */
export function readyMessageAr(fulfillmentType: "pickup" | "delivery"): string {
  return ORDER_STATUS_MESSAGE_AR.ready[fulfillmentType];
}

/** ما يحتاجه اختيار رسالة الحالة من صف الطلب — لا أكثر (بريف و §3). */
export interface StatusNotificationInput {
  status: OrderStatus;
  fulfillmentType: "pickup" | "delivery";
  /** `orders.cancellation_reason` كما خزّنه الموظف. فارغ أو مسافات = بلا سبب. */
  cancellationReason: string | null;
}

/**
 * رسالة الزبون لحالة طلب التقطها المُراقِب (FR-11، بريف و §1.1) — أو `null`
 * حين يكون **الصمت هو القرار**.
 *
 * 🔴 `null` ليست «لا أعرف»: المُراقِب يعلّم الطلب `notified = true` عليها
 *    بلا إرسال. لذلك التفرّع شامل على `OrderStatus`، وحالة جديدة تُضاف
 *    للاتحاد تكسر الترجمة هنا بدل أن تمرّ صامتة.
 *
 * - `pending_acceptance` — «استلمنا» يرسلها المحرّك عند الإنشاء (ج §15.3).
 * - `preparing` · `completed` — صمت مقصود، شوف تعليق `ORDER_STATUS_MESSAGE_AR`.
 * - `expired` — مؤجّلة (Sprint 2)، والحالة لا تُنتَج اليوم.
 * - `cancelled` — نص المطعم دائما: الإلغاء من الزبون غير ممكن في البايلوت
 *   (`cancelled_by = 'restaurant'`، د §8.2)، فلا يُبنى له مسار هنا.
 */
export function statusNotificationAr(
  order: StatusNotificationInput,
): string | null {
  switch (order.status) {
    case "pending_acceptance":
    case "preparing":
    case "completed":
    case "expired":
      return null;
    case "accepted":
      return ORDER_STATUS_MESSAGE_AR.accepted;
    case "ready":
      return readyMessageAr(order.fulfillmentType);
    case "cancelled": {
      const reason = order.cancellationReason?.trim() ?? "";
      return reason === ""
        ? ORDER_STATUS_MESSAGE_AR.cancelled.restaurant_no_reason
        : fillSlots(ORDER_STATUS_MESSAGE_AR.cancelled.restaurant, {
            [ORDER_CANCELLATION_REASON_SLOT]: reason,
          });
    }
    default: {
      const unreachable: never = order.status;
      throw new Error(`حالة طلب غير معروفة: ${String(unreachable)}`);
    }
  }
}

/**
 * «استلمنا طلبك رقم 101 — …» — **بالرقم المخزَّن** بـ`orders.order_number`.
 * `String` بتعطي أرقاما غربية، والحارس القائم بيمسك غيرها (بريف د §2.1).
 */
export function orderReceivedMessageAr(orderNumber: number): string {
  return fillSlots(ORDER_STATUS_MESSAGE_AR.pending_acceptance, {
    [ORDER_NUMBER_SLOT]: String(orderNumber),
  });
}
