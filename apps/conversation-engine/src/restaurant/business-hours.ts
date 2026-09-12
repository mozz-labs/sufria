import { z } from "zod";

/**
 * بوابة ساعات الدوام — FR-22.
 *
 * `restaurants.business_hours jsonb` موجود من هجرة 0001 وما انستعمل ولا مرة.
 * يعني ما في شكل متّفق عليه بالقاعدة — الشكل بينتعرّف هون لأول مرة، والمخطط
 * تحت هو التعريف.
 *
 * 🔴 الاتجاه عند الشك: **مفتوح**، مش مغلق.
 *
 *    مطعم ما بيقدر يستقبل طلبات بسبب فاصلة ناقصة بالـjsonb بيخسر مبيعات وهو
 *    ما بيعرف — الزبون بيوصله «المطعم مغلق حاليا» والمطعم شغّال وقاعد. بالمقابل
 *    مطعم استقبل رسالة وهو مسكّر بيشوفها بعينه وبيتصرّف. الأول عطل صامت،
 *    والتاني إزعاج ظاهر. عشان هيك حقل مشوّه = مفتوح + سطر خطأ بالسجل، مش مغلق.
 *
 *    وهاد بيتوافق مع القاعدة اللي جاية من المنتج: `business_hours` فاضي = مفتوح
 *    دايما. الفاضي والمشوّه بياخدوا نفس المعاملة، والفرق إن المشوّه بينسجّل.
 *
 * 🔴 المنطقة الزمنية **مش** جوّا هالحقل. من هجرة 0008 صارت عمود
 *    `restaurants.timezone`، وبتوصل لهون كوسيط. الشكل:
 *
 *      قبل:  business_hours = {timezone, days: {...}}
 *      بعد:  business_hours = {days: {...}}   +   restaurants.timezone
 *
 *    مفتاح `timezone` اللي بيضل جوّا الـjsonb ما بينقرا — `legacyTimezoneKey`
 *    تحت بتكشفه عشان المستدعي يسجّله بدل ما ينضرب بصمت.
 */

/** المنطقة الزمنية لما المطعم ما يحدّد وحدة. الأردن — نفس عملة `subscriptions`. */
export const DEFAULT_TIMEZONE = "Asia/Amman";

/**
 * مفاتيح الأيام. ثلاثية ولوسعة، والاتنين مقبولين بالقراءة.
 *
 * الترتيب بيبدا بالأحد لأنه أول أيام الأسبوع بالأردن — بس الترتيب هون ما إله
 * أي أثر على المنطق، المفتاح بينقرا بالاسم مش بالفهرس.
 */
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

const LONG_TO_SHORT: Record<string, DayKey> = {
  sunday: "sun",
  monday: "mon",
  tuesday: "tue",
  wednesday: "wed",
  thursday: "thu",
  friday: "fri",
  saturday: "sat",
};

/** "HH:MM" بـ24 ساعة وأرقام غربية. "9:00" مقبولة كمان — "09:00" هي المعيار. */
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

const TimeSchema = z.string().regex(TIME_RE);

const WindowSchema = z.object({
  open: TimeSchema,
  close: TimeSchema,
});

/**
 * المخطط متساهل بنفس روح `whatsapp/payload.ts`: أي مفتاح زيادة بينتجاهل، ويوم
 * ما بينفحص بيسقط لحاله بدل ما يسقّط الحقل كله. اللي بيسقّط الحقل كله هو بس
 * إنه مش كائن أصلا.
 */
const BusinessHoursSchema = z.object({
  days: z.record(z.string(), z.unknown()).optional(),
});

/**
 * مفتاح `timezone` مهجور من 0008. الهجرة شالته من كل الصفوف، فوجوده هلأ معناه
 * إشي كتبه من جديد — شاشة الإعدادات على الأغلب. بترجّع القيمة عشان المستدعي
 * يسجّلها، وما بتأثر على أي قرار: العمود هو المصدر الوحيد.
 */
export function legacyTimezoneKey(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return null;
  const value = (raw as Record<string, unknown>)["timezone"];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export interface OpenWindow {
  /** دقائق من منتصف الليل المحلي. */
  openMinutes: number;
  closeMinutes: number;
  /** النص كما أدخله المطعم — هو اللي بيروح للزبون، بلا إعادة تنسيق. */
  opensAt: string;
  closesAt: string;
}

export interface BusinessHours {
  /** جاية من عمود `restaurants.timezone`، مش من الـjsonb. */
  timezone: string;
  /** يوم غير موجود بالخريطة = مغلق كليا. مفتاح موجود بمصفوفة فاضية = نفس الشي. */
  days: Partial<Record<DayKey, OpenWindow[]>>;
  /** true لما ما في ولا يوم معرَّف — الحقل فاضي، يعني مفتوح دايما. */
  alwaysOpen: boolean;
}

function toMinutes(hhmm: string): number {
  const m = TIME_RE.exec(hhmm);
  // ما بيصير null: TimeSchema فحصها بنفس التعبير قبل ما نوصل هون.
  if (m === null) throw new Error(`وقت غير صالح: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * بترجّع null لما الحقل مش كائن أصلا — المستدعي بيعتبرها "مفتوح" وبيسجّل.
 * الحقل الفاضي `{}` **مش** null: هو قيمة صالحة معناها مفتوح دايما.
 */
export function parseBusinessHours(
  raw: unknown,
  timezone: string,
): BusinessHours | null {
  const parsed = BusinessHoursSchema.safeParse(raw);
  if (!parsed.success) return null;

  // العمود NOT NULL وعليه CHECK بيمنع الفاضي، فهاد احتياط لمستدعي مش من القاعدة
  // (اختبار، أو صف انقرا قبل 0008) — مش مسار متوقّع.
  const zone = timezone.trim() === "" ? DEFAULT_TIMEZONE : timezone;
  const days: Partial<Record<DayKey, OpenWindow[]>> = {};
  let defined = 0;

  for (const [rawKey, rawValue] of Object.entries(parsed.data.days ?? {})) {
    const key = normaliseDayKey(rawKey);
    if (key === null) continue;

    const windows = WindowSchema.array().safeParse(rawValue);
    if (!windows.success) continue;

    defined++;
    days[key] = windows.data
      .map((w) => ({
        openMinutes: toMinutes(w.open),
        closeMinutes: toMinutes(w.close),
        opensAt: w.open,
        closesAt: w.close,
      }))
      // 🔴 نافذة صفرية (open == close) بتنشال، ما بتنفهم كـ24 ساعة. مطعم بدّه
      //    24 ساعة بيسيب business_hours فاضي — وهاد المسار الموثّق الوحيد.
      //    تفسير "00:00 لـ00:00" كيوم كامل بيخلي غلطة إدخال تفتح المطعم أبدا.
      .filter((w) => w.openMinutes !== w.closeMinutes)
      .sort((a, b) => a.openMinutes - b.openMinutes);
  }

  return { timezone: zone, days, alwaysOpen: defined === 0 };
}

function normaliseDayKey(raw: string): DayKey | null {
  const lower = raw.trim().toLowerCase();
  if ((DAY_KEYS as readonly string[]).includes(lower)) return lower as DayKey;
  return LONG_TO_SHORT[lower] ?? null;
}

/** اللحظة الحالية بتوقيت المطعم: أي يوم، وكم دقيقة مرّت من منتصف الليل. */
interface LocalMoment {
  day: DayKey;
  minutes: number;
}

/**
 * التحويل للمنطقة الزمنية بيمرّ من `Intl`, مش من حساب إزاحة يدوي.
 *
 * 🔴 الإزاحة اليدوية (`getTimezoneOffset` أو ثابت +03:00) بتنكسر على التوقيت
 *    الصيفي: البلد اللي بتقدّم ساعتها بتصير كل نوافذ الدوام غلط ساعة كاملة
 *    مرتين بالسنة، ونص الدوام بيصير "مغلق" وهو مفتوح. `Intl` بيقرا قاعدة
 *    IANA كاملة بتعرف تواريخ التحويل لكل منطقة.
 *
 * بترمي `RangeError` لمنطقة زمنية مش معروفة — المستدعي بيمسكها.
 */
function localMoment(now: Date, timezone: string): LocalMoment {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";

  const day = get("weekday").toLowerCase() as DayKey;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return { day, minutes };
}

function previousDay(day: DayKey): DayKey {
  const i = DAY_KEYS.indexOf(day);
  // ما بيصير -1: القيمة جاية من Intl بنفس الاختصارات الثلاثية.
  return DAY_KEYS[(i + DAY_KEYS.length - 1) % DAY_KEYS.length] ?? day;
}

export interface HoursDecision {
  open: boolean;
  /**
   * نافذة اليوم المحلي الحالي، لرسالة الإغلاق. null لما اليوم مغلق كليا أو
   * الحقل ما بينقرا — وقتها الرسالة بتصير القصيرة.
   *
   * 🔴 أول نافذة باليوم وبس. دوام مقسوم (10:00-14:00 و18:00-23:00) بيعرض
   *    الأولى، لأن نص الرسالة فيه خانتين مش أربعة. مقصود ومسجّل بالثغرات
   *    المعروفة — والبديل (حساب "النافذة الجاية") هو بالضبط الوعد المحسوب
   *    اللي هالتصميم بيتجنّبه.
   */
  todayWindow: { opensAt: string; closesAt: string } | null;
}

/** مفتوح دايما: ما في ساعات معرّفة، أو الحقل ما انقرا. */
const ALWAYS_OPEN: HoursDecision = { open: true, todayWindow: null };

/**
 * القرار الوحيد اللي هالملف موجود عشانه: هل المطعم مفتوح هلأ، وشو بينعرض
 * بالرسالة لو مسكّر.
 *
 * حالتان حدّيتان بتنحلّوا هون بالذات:
 *
 *   1. **إغلاق بعد منتصف الليل** — نافذة 22:00 -> 02:00 معناها `close < open`.
 *      الساعة 01:00 بتنتمي لنافذة **امبارح**، مش لنافذة اليوم. عشان هيك بينفحص
 *      اليوم السابق كمان، مش اليوم الحالي بس. بلا هالفحص كل مطعم بيسكّر بعد
 *      منتصف الليل بيرفض زبائنه بأنشط ساعاته.
 *
 *   2. **المنطقة الزمنية** — الخادم ممكن يكون بأي مكان. المقارنة كلها بتصير
 *      بالوقت المحلي للمطعم، واللحظة بتتحوّل مرة وحدة فوق.
 *
 * الوسيطين الأولين هما حقلَي صف المطعم بالترتيب اللي بينقرا فيه: الساعات
 * والمنطقة الزمنية (عمود `restaurants.timezone` من 0008)، وبعدين الساعة.
 */
export function decideHours(
  raw: unknown,
  timezone: string,
  now: Date,
): HoursDecision {
  const hours = parseBusinessHours(raw, timezone);
  if (hours === null || hours.alwaysOpen) return ALWAYS_OPEN;

  let moment: LocalMoment;
  try {
    moment = localMoment(now, hours.timezone);
  } catch {
    // منطقة زمنية مش معروفة. نفس اتجاه الشك: مفتوح.
    return ALWAYS_OPEN;
  }

  const todayWindows = hours.days[moment.day] ?? [];
  const first = todayWindows[0];
  const todayWindow =
    first === undefined
      ? null
      : { opensAt: first.opensAt, closesAt: first.closesAt };

  // نوافذ اليوم نفسه.
  for (const w of todayWindows) {
    const crossesMidnight = w.closeMinutes < w.openMinutes;
    const inside = crossesMidnight
      ? moment.minutes >= w.openMinutes
      : moment.minutes >= w.openMinutes && moment.minutes < w.closeMinutes;
    if (inside) return { open: true, todayWindow };
  }

  // ذيل نافذة امبارح اللي عبرت منتصف الليل.
  for (const w of hours.days[previousDay(moment.day)] ?? []) {
    if (w.closeMinutes < w.openMinutes && moment.minutes < w.closeMinutes) {
      return { open: true, todayWindow };
    }
  }

  return { open: false, todayWindow };
}
