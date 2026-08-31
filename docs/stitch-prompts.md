# Stitch Prompts — Sufria Dashboard (كل الشاشات)

> **الحالة: 🧊 مجمّد — v1.1 · 13 أغسطس 2026**
> النص الحالي مقفول. لا صقل، لا إعادة صياغة، لا إضافة شاشات، لحد ما يتحقق شرط فك التجميد تحت.
> السبب مش إن الملف ناقص — السبب إن كل تعديل عليه هلق بينحذف لما البراند يوصل. التجميد بيحمي الوقت، مش الملف.

---

## ⚠️ قبل أي شي — شو هاد الملف وشو مش هو

هاد الملف **مش على المسار الحرج لـSprint 0 ولا Sprint 1**.

Sprint 0 كله باك اند: repos، ORM، migrations، RLS، Guard، حساب Meta. ولا بند فيه بيلمس البراند. Sprint 1 داشبورد وظيفي على توكنز DESIGN.md — والتوكنز مقفولة أصلا ما عدا `--accent`.

**اللي فعلا موقوف على الاسم والشعار:** الدومين، صفحة الهبوط، دك العرض للجنة. لازمين Sprint 5 (18-22 أكتوبر)، مش هلق.

فخلّي مسار البراند يمشي بالتوازي زي بالضبط ما ماشي قرار بلد الإطلاق. **ما تخلّيه بوابة.**

---

## 🔓 شرط فك التجميد

بينفك لما **الاثنين** يتحققوا، مش واحد:

1. **الاسم مقفول** — متحقق من توفره كدومين وعلامة تجارية وحساب سوشال. مقفول يعني مفحوص، مش يعني عاجبنا.
2. **الشعار مسلَّم من المصمم** — SVG، نسخة أفقية ونسخة مربعة، فاتح وغامق.

عند تحققهم، فك التجميد **شغل ساعة، مش إعادة تفكير** — لأن الملف مكتوب من البداية بحيث يكون كذلك. شوف الشيك ليست تحت.

---

## ✅ شيك ليست تبديل البراند (نفّذها بالترتيب وقت فك التجميد)

| # | الشي | الملف | الشغلة |
|---|---|---|---|
| 1 | `--accent` فاتح | `DESIGN.md` §2 | استبدال `#0E7C7B` باللون النهائي |
| 2 | `--accent` غامق | `DESIGN.md` §2 | نسخة أفتح من نفس اللون — **نفس الهوية بسطوع مختلف، مش لون تاني** |
| 3 | تحذير الـplaceholder | `DESIGN.md` §3 | يُحذف القسم كله |
| 4 | تصادم `preparing` | `DESIGN.md` §4 | البنفسجي مختار عشان يبعد عن التركوازي. **لو اللون الجديد بنفسجي/موف، لازم `preparing` تتغير** — القاعدة إن لون البراند ولون الحالة ما ينخلطوا أبدا |
| 5 | تباين `--accent` | — | فحص ضد `--surface` بالوضعين. الحد 4.5:1 للنص، 3:1 للحدود |
| 6 | الشعار النصي | هاد الملف | استبدال `text wordmark placeholder` بـ`the Sufria logo (SVG provided)` بكل برومبت فيه |
| 7 | صفحات التسويق | جديد | صفحة الهبوط والصفحات العامة تُكتب برومبتاتها — مستثناة عمدا من هاد الملف |

**البند 4 هو الوحيد يلي ممكن يكسر شي.** الباقي استبدال قيم.

---

## 🚫 قرار مقفول: تجاهُل توكنز Stitch

**الملاحظة:** Stitch بيحقن ~70 توكن Material فوق نظامنا. تكرر مرتين على شاشة 0. مش قابل للإصلاح ببرومبت.

**القرار (مقفول، موثّق هون عشان ما ينضاع بالمحادثات):**

> **مخرجات Stitch مرجع تخطيط وهيكل فقط. الفرونت اند بياخد الألوان الـ14 والخطوط والمسافات من `DESIGN.md` وقت كتابة الكود، ولا يستورد ولا توكن من Stitch إطلاقا.**

فحص القبول على أي شاشة مبنية: تفتيش على أي `md-sys-*` أو `--md-` أو hex خام مش موجود بـDESIGN.md. أي واحد منهم = الشاشة مرفوضة.

**لا تصرفوا وقت زايد بمحاولة إقناع Stitch يحترم النظام.** جُرِّب مرتين وفشل. الشاشة المولّدة قيمتها بالتخطيط، والتخطيط بيوصل صح.

---

## طريقة الاستخدام

1. ارفع `DESIGN.md` لـStitch أول شي، بنفس الجلسة.
2. ولّد الشاشات **بالترتيب المكتوب** — التناسق بيتحسّن لما الشاشات المتشابهة تتولّد ورا بعض.
3. كل prompt مكتوب عشان يُلصق كما هو.
4. لو الناتج طلع بالإنجليزي أو LTR، أعد التوليد مع إضافة السطر: `The entire interface must be in Arabic with right-to-left layout.`

**⚠️ استقرار:** شاشات 1–11 مبنية على قرارات مقفولة. شاشات 12–15 (تحليلات Sprint 4) مبنية على بيانات ما شفناها بعد — **متوقع تُعاد بعد البايلوت الحقيقي**، فما تصرفوا عليها وقت صقل زايد الآن.

**⚠️ الشعار:** كل شاشة فيها شعار، استخدم كلمة نصية مؤقتة فقط. صفحة الهبوط والصفحات التسويقية **مش هون عمدا** — بتنبني بعد ما يخلص الشعار والاسم.

---

## 0. الهيكل العام (ولّد هاد أول شي — كل الشاشات بترثه)

```
Design an RTL Arabic dashboard shell for a restaurant order-management platform.

Layout: a fixed navigation sidebar on the RIGHT side of the screen (this is an RTL interface — the sidebar is on the right, not the left). Main content area to the left of it.

Sidebar contains, top to bottom:
- A text wordmark placeholder at the top
- Navigation items with icon + Arabic label: الطلبات الحية، القائمة، الزبائن، التحليلات، الإعدادات
- At the bottom: the logged-in staff member's name, their restaurant name, and a logout item

The active navigation item is marked with the accent colour as a right-edge bar plus a subtle tinted background.

Top bar of the main area: page title on the right, and on the left a connection-status indicator and a light/dark mode toggle.

Keep it calm and dense. Borders, not shadows. All labels in Arabic, all numerals Western.
```

---

## 1. تسجيل دخول الموظف — Sprint 1

```
Design an RTL Arabic login screen for restaurant staff.

Centred card on a plain background. Contains:
- A text wordmark placeholder at the top (no logo image)
- Arabic heading: تسجيل الدخول
- Field: البريد الإلكتروني أو رقم الهاتف
- Field: كلمة المرور, with a show/hide toggle
- Primary full-width button: دخول
- A small text link: نسيت كلمة المرور؟

Show a second variant of the same card in an error state: a short Arabic message below the password field reading بيانات الدخول غير صحيحة, with the field border in the red family.

Labels sit above their fields and are right-aligned. No social login, no sign-up link — accounts are created by the platform, not self-registered.
```

---

## 2. لوحة الطلبات الحية — Sprint 1 ⭐ أهم شاشة بالمنتج

```
Design the live orders board for an RTL Arabic restaurant dashboard. This is the screen staff stare at all shift — prioritise instant scanning over decoration.

A responsive grid of order cards. Each card shows:
- Customer name (right-aligned, semibold)
- Order items as a compact list, e.g. 2× شاورما دجاج، 1× حمص
- Order total
- A status badge (pill shape, tinted background with darker text of the same family)
- A relative timestamp such as منذ 5 دقائق
- A fulfilment tag: استلام or توصيل
- A payment tag: دفع إلكتروني or نقدا عند الاستلام

Show cards covering ALL SEVEN statuses so the colour system is visible at once:
بانتظار القبول (orange family), تم القبول (blue-grey family), قيد التحضير (PURPLE family), جاهز للاستلام (yellow family), مكتمل (green family), ملغى (red family), انتهت الصلاحية (NEUTRAL GREY family).

Critical: ملغى and انتهت الصلاحية must look clearly different from each other — one is a cancellation, the other is an unclaimed pickup that timed out. Do not give them similar colours.

On two cards only, show a small pulsing accent-coloured dot immediately before the customer name, indicating the order updated less than a minute ago. Do not put this dot on every card.

Above the grid: filter chips for الكل، بانتظار القبول، قيد التحضير، جاهز, and a total count.

Also produce an empty state for this screen: a short Arabic sentence explaining that new WhatsApp orders will appear here automatically, with no error styling.
```

---

## 3. تفاصيل الطلب وتحديث الحالة — Sprint 1

```
Design an RTL Arabic order detail panel for a restaurant dashboard, shown as a side drawer opening from the right.

Contents top to bottom:
- Order number and current status badge
- Customer block: name, phone number, and a small tag if they are a VIP or a returning customer
- Fulfilment type and payment method
- Itemised list: item name, quantity, unit price, line total, plus any special note per item
- Totals: subtotal and total
- A vertical status timeline showing each transition with who triggered it and when — e.g. تم الإنشاء — الزبون، تم القبول — أحمد، قيد التحضير — أحمد

Action buttons at the bottom.

CRITICAL PRODUCT RULE — show these as two separate variants:

Variant A: an order paid online. The قبول الطلب button is enabled.

Variant B: an online order where payment is NOT yet confirmed. The قبول الطلب button is DISABLED, and directly beneath it a short explanatory line reads: لا يمكن قبول الطلب قبل تأكيد الدفع. In this state the only enabled action is إلغاء الطلب. Never show a disabled button without this explanation.

Also design a confirmation modal for cancellation: Arabic heading تأكيد إلغاء الطلب, a short warning line, an optional reason field, and two buttons — a destructive-styled تأكيد الإلغاء and a neutral تراجع.
```

> **فجوة معروفة (تُعالَج وقت فك التجميد، مش الآن):** هاد البرومبت ما بيغطي حالتين موجودتين بالنظام —
> طلب `expired` (انتهت صلاحية استلام بعد 24 ساعة، `cancelled_by='system'`)، وطلب كاش مكتمل انتقل `payment_status` تبعه لـ`collected`.
> الاتنين بيظهروا بلوحة الطلبات (شاشة 2) وبيحتاجوا عرض بدرج التفاصيل كمان. Sprint 1 بيغطيهم بالكود بأي حال — التصميم بيلحق.

---

## 4. تنبيهات وحالات النظام — Sprint 1/2

```
Design a set of RTL Arabic system state components for a restaurant dashboard:

1. A connectivity warning banner across the top of the content area: تعذّر الاتصال بالخادم — نحاول إعادة الاتصال. Amber-family, non-blocking, with a small spinner.

2. A warning flag that appears inside an order card: this order is marked as cash payment but an online payment was received for it. The Arabic text reads: هذا الطلب مدفوع إلكترونيا رغم أنه محدد كدفع نقدي — لا تُحصّل نقدا. Style it as a high-visibility inline alert inside the card, red-family, impossible to miss.

3. A refund notice inside an order card: تم استرجاع المبلغ تلقائيا, neutral styling with a small note of the reason.

4. A toast notification component for successful actions, appearing bottom-right, auto-dismissing.
```

---

## 5. تسجيل مطعم جديد والملف الشخصي — Sprint 3

```
Design an RTL Arabic restaurant profile / registration form for a dashboard.

Sections with headings:
- معلومات المطعم: restaurant name, logo upload area (drag-and-drop, empty placeholder state), location/address
- ساعات العمل: a weekly schedule editor, each day with open and close times and a closed toggle
- خيارات الاستلام: toggles for هل تقدم خدمة التوصيل؟
- خيارات الدفع: toggles for قبول الدفع الإلكتروني and قبول الدفع نقدا عند الاستلام
- نسبة العمولة المفترضة: a percentage input, with a short helper line explaining it is used to calculate how much the restaurant saves versus aggregator commission

Sticky save bar at the bottom with حفظ التغييرات as the primary button and a disabled state when nothing changed.
```

---

## 6. إعداد رقم واتساب وحالة التحقق — Sprint 3

```
Design an RTL Arabic WhatsApp number setup screen for a restaurant dashboard.

Show a status card with three distinct variants:

Variant 1 — بانتظار التحقق: amber-family, showing the submitted number, a note that Meta verification usually takes 2 to 5 business days and may take longer, and a progress indicator.

Variant 2 — تم التحقق: green-family, showing the verified number, a QR code block customers scan to start ordering, a copyable wa.me link, and a زر تحميل رمز QR button.

Variant 3 — مرفوض: red-family, showing a short reason line and a إعادة تقديم الطلب button.

Below the status card, a short Arabic explanation of what the number is used for.
```

---

## 7. إدارة القائمة — التصنيفات والأصناف — Sprint 3

```
Design an RTL Arabic menu management screen for a restaurant dashboard.

Two-column layout: a narrow categories list on the RIGHT, item list on the left.

Categories column: each category is a reorderable row with a drag handle, the category name, an item count, and an active/inactive toggle. A إضافة تصنيف button at the bottom.

Items area: cards or rows for each menu item showing a thumbnail, name, short description, price, and an availability toggle labelled متوفر / غير متوفر. Each item has edit and delete icons.

Show one item in an unavailable state — visually dimmed but still clearly readable, not hidden.

Include an empty state for a category with no items yet, and a إضافة صنف primary button.
```

---

## 8. إضافة أو تعديل صنف — Sprint 3

```
Design an RTL Arabic form for adding or editing a menu item, as a modal over the menu screen.

Fields: اسم الصنف, الوصف (multiline), السعر (numeric with currency suffix), التصنيف (select), صورة الصنف (upload area with preview and remove option), الوسوم (tag chips such as نباتي، حار — addable and removable), متوفر حاليا (toggle).

Show a validation error variant: the price field with a red-family border and a short message السعر مطلوب ويجب أن يكون رقما موجبا.

Footer: حفظ primary button and إلغاء secondary button.
```

---

## 9. إعدادات الرسائل التلقائية — Sprint 3

```
Design an RTL Arabic message templates settings screen for a restaurant dashboard.

A list of message templates, each as an expandable row: template name in Arabic (رسالة الترحيب، تم قبول الطلب، قيد التحضير، جاهز للاستلام، تم الإلغاء، انتهت الصلاحية), a preview of the message text, and an approval status badge (معتمد / بانتظار الموافقة / مرفوض).

When expanded: an editable text area showing the message with variable placeholders highlighted (e.g. {{اسم الزبون}}، {{رقم الطلب}}), a live preview rendered as a WhatsApp-style message bubble, and a حفظ وإرسال للاعتماد button.

Add a short Arabic explanatory note that edited templates require approval before they go live.
```

---

## 10. سجل الزبائن — Sprint 3

```
Design an RTL Arabic customer records table for a restaurant dashboard.

Table columns, right to left: اسم الزبون (with a VIP tag where applicable), رقم الهاتف, عدد الطلبات, إجمالي الإنفاق, آخر طلب (relative date).

Above the table: a search field, a filter for VIP only, and a total customer count.

Each row is clickable and opens the customer profile.

Include an empty state and a loading skeleton variant.

All numerals Western. No zebra striping — rows separated by a single border line.
```

---

## 11. الاشتراك والفوترة — Sprint 3

```
Design an RTL Arabic subscription and billing screen for a restaurant dashboard.

A current plan card showing: plan name, fixed monthly price, status badge (تجريبي / نشط / متأخر السداد / ملغى), current billing period dates, and next charge date.

A prominent short line reinforcing the value proposition: اشتراك شهري ثابت — بدون أي عمولة على الطلبات.

Below: a billing history table with date, amount, and status per row, plus a download-invoice icon.

Show a variant of the plan card in a متأخر السداد state: amber/red-family with a تحديث طريقة الدفع action.
```

---

## 12. الصفحة الرئيسية والتحليلات + Health Score — Sprint 4 ⚠️

```
Design the RTL Arabic dashboard home screen for a restaurant order platform, combining basic analytics with an ownership indicator.

Top row: four compact stat cards — عدد الطلبات، الإيرادات، نسبة الزبائن المتكررين، متوسط قيمة الطلب. Each shows a large Western numeral and a small period-comparison line.

Below, the hero component — a combined Ownership / Health Score card. It shows:
- A large percentage: the share of revenue from directly-owned repeat customers
- A large currency figure: the estimated amount saved versus aggregator commission this period
- A short Arabic line explaining the saving is calculated against the restaurant's configured commission rate

CRITICAL RULE: directly beneath the figures, always show the underlying sample size in muted small text, e.g. بناء على 8 طلبات فقط. This must never be hidden, even when the sample is large. The point is to avoid implying false precision.

Below that: a simple line chart of orders over time with a date-range filter.

Also produce an empty state variant for a restaurant with no completed orders yet.
```

---

## 13. قمع التحويل — Revenue Leakage — Sprint 4 ⚠️

```
Design an RTL Arabic conversion funnel screen for a restaurant dashboard.

A horizontal funnel visualisation flowing RIGHT to LEFT (this is an RTL interface — the widest stage starts on the right). Five stages: بدأ المحادثة، تصفح القائمة، مراجعة السلة، اختيار الدفع، أتم الطلب.

Each stage shows an absolute count and, between consecutive stages, the drop-off percentage highlighted in an amber or red family so losses are obvious.

Below the funnel: a short Arabic insight line pointing at the largest drop, e.g. أكبر نسبة فقدان بين اختيار الدفع وإتمام الطلب.

Include a date-range filter and an empty state.

Show the sample size for the period in muted text.
```

---

## 14. ملف الزبون والخط الزمني — Sprint 4 ⚠️

```
Design an RTL Arabic customer profile screen for a restaurant dashboard.

Header: customer name, phone number, VIP badge if applicable, and three summary stats — عدد الطلبات، إجمالي الإنفاق، آخر طلب.

Main content: a vertical chronological timeline flowing top to bottom, with the marker line on the RIGHT side. Timeline entries include: أول طلب، طلبات لاحقة (with order number, items summary and total), ترقية إلى VIP as a distinct milestone marker, طلب ملغى and طلب انتهت صلاحيته shown in their own status colours.

IMPORTANT: cancelled and expired orders DO appear in this timeline — the timeline is a raw history of everything. This is different from the summary stats at the top, which count completed orders only. Make the visual distinction clear.

Include a compact filter to show all events or orders only.
```

---

## 15. الزبائن المعرّضون للمغادرة — Sprint 4 ⚠️

```
Design an RTL Arabic at-risk customers screen for a restaurant dashboard.

A list of customers flagged as at risk. Each row shows: customer name, their usual ordering interval (e.g. يطلب كل 9 أيام تقريبا), how long it has been since their last order (e.g. مضى 27 يوما), total lifetime spend, and an at-risk severity indicator.

CRITICAL PRODUCT RULE: the system NEVER sends any automated message. The only actions available are manual ones for the restaurant — a فتح محادثة واتساب action that opens a chat with that customer, and a عرض ملف الزبون action. Do not design any "send campaign", "send offer", or bulk-message feature. Do not imply automation anywhere on this screen.

Each row must show its sample size in muted text, e.g. بناء على 6 طلبات سابقة.

Add a short Arabic explanatory note at the top of the screen stating that customers with too little order history are not flagged, to avoid false signals.

Include an empty state reading that no customers are currently at risk.
```

---

## ترتيب التوليد المقترح

| الجولة | الشاشات | ليش |
|---|---|---|
| 1 | 0 → 1 → 2 → 3 → 4 | جوهر Sprint 1، أهم شي يتقن |
| 2 | 5 → 6 → 7 → 8 | فورمات وإدارة، متشابهة ببعضها |
| 3 | 9 → 10 → 11 | جداول وإعدادات |
| 4 | 12 → 13 → 14 → 15 | تحليلات — الأقل استقرارا |

بعد كل جولة، صدّر لـFigma وراجع التناسق قبل ما تكمل — Stitch بيضعف تناسقه بالجلسات الطويلة، فالتصدير المرحلي بيقلل الخطر.

---

## سجل التغييرات

**v1.1 — 13 أغسطس 2026**
- الملف اتجمّد رسميا بشرط فك واضح (اسم مقفول + شعار مسلَّم)، بدل "مجمّد لحد ما يخلص الشعار" المفتوحة.
- انضافت شيك ليست تبديل البراند — سبعة بنود، البند 4 (تصادم `preparing` مع لون البراند) هو الوحيد يلي ممكن يكسر شي.
- قرار تجاهُل توكنز Material تبع Stitch انكتب **جوا الملف** مع فحص قبول قابل للتنفيذ. كان عايش بالمحادثة بس، وهو أول شي بينضاع.
- انضافت توضيحة إن الملف مش على المسار الحرج لـSprint 0/1، وشو فعلا موقوف على البراند.
- انوثقت فجوة معروفة بشاشة 3 (`expired` و `collected` غير مغطيين).
- الـ16 برومبت نفسهم **ما تغيّروا ولا حرف** — التجميد كان قبل أي صقل، لا بعده.
