import {
  matchCommand,
  normalizeArabic,
  type CustomerCommand,
} from "./normalize.js";

/**
 * محلّل الأصناف، وموزّع الرسالة الواردة أثناء التصفّح.
 *
 * 🔴 **قاعدة العلامة الصريحة هي الفرق بين محلّل صحيح ومحلّل يخمّن.**
 *    رقم مجرّد = **رقم صنف دائما**. الكمية تلزمها `×` أو `x` أو `*`.
 *    بدونها «2 و5» بتصير «صنف 2 كمية 5» — وهي الغلطة اللي وُجد سطر الإضافة
 *    ليمسكها. ممنوع يخمّن المحلّل ثم نتّكل على السطر ليصحّح.
 *
 * 🔴 **`menu_map` هي الحقيقة، لا جدول `menu_items`.** المحلّل ما بيلمس القاعدة
 *    إطلاقا: بياخد الخريطة المخزّنة لحظة إرسال القائمة، و`N` = عدد مفاتيحها.
 *    عدّ صفوف من القاعدة بيعطي رقما مختلفا عن اللي شافه الزبون أول ما يخفي
 *    المطعم صنفا — وهاد الخطأ الصامت #2 عائدا من باب المحلّل.
 */

/** سقف الكمية للصنف الواحد — حماية من `2 ×9999`. */
export const MAX_QTY_PER_ITEM = 20;

/** علامات الكمية الصريحة. `X` الكبيرة نفس `x` — حرف واحد بحالتين، لا علامة جديدة. */
const QTY_MARKERS = "×x*";

export interface ParsedItem {
  /** رقم الصنف كما ظهر بالقائمة. */
  readonly number: number;
  readonly itemId: string;
  readonly qty: number;
}

export interface ParseProblems {
  /** أرقام مش موجودة بـ`menu_map` — بتتسمّى بالرد وما بتسقّط الصحيح. */
  readonly unknownNumbers: readonly number[];
  /** أجزاء نصية ما انفهمت. بتترجع للزبون نصا — لا ملاحظة ولا حذف صامت. */
  readonly unclearParts: readonly string[];
  /** أصناف كميتها تجاوزت السقف. ⚠️ بلا نص معتمد — انظر التعليق تحت. */
  readonly overCapItems: readonly {
    readonly number: number;
    readonly requestedQty: number;
  }[];
}

/**
 * ثلاث حالات لا اثنتان.
 *
 * 🔴 بدون التفريق بين `partial` و`unparsed` ما بينفّذ قيد 2ج: العدّاد بيحسب
 *    الرسائل اللي **ما انفهم منها شي إطلاقا**، و**رسالة نجح نصها مش رسالة
 *    غير مفهومة**. دمج الاتنتين بيخلّي زبونا بيضيف صنفا ويكتب «بدون بصل»
 *    يتقدّم نحو رسالة الاستسلام وهو عم يطلب بنجاح.
 */
export type ParseOutcome =
  /** صنف واحد على الأقل، وولا مشكلة. */
  | "parsed"
  /** صنف واحد على الأقل، ومعه رقم غلط أو نص غير واضح. */
  | "partial"
  /** ولا صنف. */
  | "unparsed";

export interface ParseResult {
  readonly outcome: ParseOutcome;
  readonly items: readonly ParsedItem[];
  readonly problems: ParseProblems;
  /** `N` برسائل الخطأ = عدد مفاتيح `menu_map`. */
  readonly menuSize: number;
}

export type MenuMap = Readonly<Record<string, string>>;

// ---------------------------------------------------------------------------
// التقطيع
// ---------------------------------------------------------------------------

/**
 * الفواصل: مسافة · `و` · `,` · `،` · `+` · سطر جديد.
 *
 * 🔴 `و` فاصل **بس لما تكون منفصلة أو ملزوقة برقم**. شطبها من أول كل كلمة
 *    بيحوّل «واحد» لـ«احد» — والنص غير المفهوم بيرجع للزبون حرفيا، فتشويهه
 *    بيخلّيه يقرأ كلمة ما كتبها.
 *
 * ⚠️ حالة معروفة: علامة كمية بأول الرسالة (`×3 و2`) بيقصّها التطبيع من الطرف،
 *    فبتنقرأ «صنف 3». مدخل بلا معنى أصلا (ما في صنف قبلها)، وتصحيحه بيتطلب
 *    تعديل `normalizeArabic` المشتركة — وهي بتخدم المطابقة كمان.
 */
function tokenize(raw: string): string[] {
  return normalizeArabic(raw)
    .replace(/[,،+]/gu, " ")
    .replace(/(?<=[0-9])و(?=[0-9])/gu, " ") // 2و3
    .replace(/(^|\s)و(?=[0-9])/gu, "$1 ") // 2 و3
    .replace(/(^|\s)و(?=\s|$)/gu, "$1 ") // 2 و 3
    .split(/\s+/u)
    .filter((t) => t !== "");
}

const BARE_NUMBER = /^[0-9]+$/u;
const NUMBER_WITH_QTY = new RegExp(`^([0-9]+)[${QTY_MARKERS}]([0-9]+)$`, "iu");
const QTY_ONLY = new RegExp(`^[${QTY_MARKERS}]([0-9]+)$`, "iu");
const MARKER_ONLY = new RegExp(`^[${QTY_MARKERS}]$`, "iu");

// ---------------------------------------------------------------------------
// المحلّل
// ---------------------------------------------------------------------------

/**
 * بيحلّل رسالة أصناف مقابل `menu_map`.
 *
 * القواعد المنفَّذة، وكل وحدة إلها اختبار باسمها:
 *   - `2 5`   → صنفان. **لا «صنف 2 كمية 5»**
 *   - `2 ×3`  → صنف 2 كمية 3
 *   - `2 و2`  → صنف 2 ×2 (الرقم المكرر بتتجمّع كميته)
 *   - رقم برّا الخريطة بيتسمّى وما بيسقّط الصحيح
 *   - نص غير رقمي بيرجع للزبون
 */
export function parseItems(raw: string, menuMap: MenuMap): ParseResult {
  const menuSize = Object.keys(menuMap).length;

  /** الكميات متجمّعة برقم الصنف، وبترتيب أول ظهور. */
  const quantities = new Map<number, number>();
  const unknownNumbers: number[] = [];
  const unclearParts: string[] = [];
  const overCapItems: { number: number; requestedQty: number }[] = [];

  /** أجزاء غير مفهومة متتالية بتتجمّع بجملة وحدة — «بدون بصل»، لا جزأين. */
  let unclearRun: string[] = [];
  const flushUnclear = (): void => {
    if (unclearRun.length > 0) {
      unclearParts.push(unclearRun.join(" "));
      unclearRun = [];
    }
  };

  /** آخر رقم صنف مقبول — العلامة المنفصلة (`2 ×3` / `2 × 3`) بتلزق فيه. */
  let lastNumber: number | null = null;
  /**
   * كم أضاف آخر رمز مقبول لـ`lastNumber`.
   *
   * 🔴 العلامة المنفصلة **بتستبدل** مساهمة الرمز اللي قبلها، ما بتزيد عليها.
   *    `2 × 3` = `2` أضافت 1، وبعدين `3` لازم تخلّي المجموع 3 — يعني `3 - 1`.
   *    الزيادة المباشرة بتعطي 4.
   */
  let lastContribution = 0;
  /** الرقم السابق كان برّا الخريطة: كميته بتنبلع، لأن الرقم انتسمّى أصلا. */
  let lastNumberWasUnknown = false;
  /** علامة منفصلة تنتظر كميتها (`2 × 3`). */
  let pendingMarker = false;

  const addQty = (number: number, qty: number): void => {
    quantities.set(number, (quantities.get(number) ?? 0) + qty);
  };

  /** كمية وصلت بعلامة منفصلة: بتستبدل مساهمة الرمز السابق. */
  const applySeparatedQty = (qty: number): void => {
    if (lastNumber === null) return;
    addQty(lastNumber, qty - lastContribution);
    lastContribution = qty;
  };

  const acceptNumber = (number: number, qty: number): void => {
    flushUnclear();
    if (menuMap[String(number)] === undefined) {
      unknownNumbers.push(number);
      lastNumber = null;
      lastContribution = 0;
      lastNumberWasUnknown = true;
      return;
    }
    addQty(number, qty);
    lastNumber = number;
    lastContribution = qty;
    lastNumberWasUnknown = false;
  };

  for (const token of tokenize(raw)) {
    // 🔴 كمية بعد علامة منفصلة: الرقم **مش مجرّد**، قبله علامة صريحة كتبها
    //    الزبون. قاعدة «رقم مجرّد = صنف» بتنطبق على المجرّد وبس.
    if (pendingMarker && BARE_NUMBER.test(token)) {
      pendingMarker = false;
      if (lastNumber !== null || lastNumberWasUnknown) {
        applySeparatedQty(Number(token));
        continue;
      }
    }
    pendingMarker = false;

    if (MARKER_ONLY.test(token)) {
      if (lastNumber !== null || lastNumberWasUnknown) {
        pendingMarker = true;
        continue;
      }
      unclearRun.push(token);
      continue;
    }

    const withQty = NUMBER_WITH_QTY.exec(token);
    if (withQty !== null) {
      acceptNumber(Number(withQty[1]), Number(withQty[2]));
      continue;
    }

    const qtyOnly = QTY_ONLY.exec(token);
    if (qtyOnly !== null) {
      // `×3` لحالها بتلزق بالصنف اللي قبلها. بلا صنف قبلها ما إلها معنى.
      if (lastNumber !== null || lastNumberWasUnknown) {
        flushUnclear();
        applySeparatedQty(Number(qtyOnly[1]));
        continue;
      }
      unclearRun.push(token);
      continue;
    }

    if (BARE_NUMBER.test(token)) {
      acceptNumber(Number(token), 1);
      continue;
    }

    unclearRun.push(token);
    lastNumber = null;
    lastContribution = 0;
    lastNumberWasUnknown = false;
  }
  flushUnclear();

  // 🔴 السقف بينطبق على **المجموع بعد التجميع**، مش على كل علامة لحالها:
  //    «2 ×15 و2 ×10» مجموعها 25، وفحص كل علامة لحالها بيمرّقها.
  const items: ParsedItem[] = [];
  for (const [number, qty] of quantities) {
    const itemId = menuMap[String(number)];
    if (itemId === undefined) continue;
    if (qty > MAX_QTY_PER_ITEM) {
      overCapItems.push({ number, requestedQty: qty });
      continue;
    }
    if (qty > 0) items.push({ number, itemId, qty });
  }

  const problems: ParseProblems = {
    unknownNumbers,
    unclearParts,
    overCapItems,
  };
  const hasProblem =
    unknownNumbers.length > 0 ||
    unclearParts.length > 0 ||
    overCapItems.length > 0;

  const outcome: ParseOutcome =
    items.length === 0 ? "unparsed" : hasProblem ? "partial" : "parsed";

  return { outcome, items, problems, menuSize };
}

// ---------------------------------------------------------------------------
// الموزّع — الترتيب إلزامي
// ---------------------------------------------------------------------------

/**
 * 🔴 `^شيل <رقم>$` **مرساة على الطرفين**، لا احتواء.
 *    بلا الإرساء «بدي شيل 2 صحون من هاد» بتحذف صنفا — وهي نفس ثغرة
 *    `includes` اللي إلها اختباران سالبان بـب-1، عائدة من باب تاني. §12.4
 */
const REMOVE_COMMAND = /^شيل\s+([0-9]+)$/u;

export type MessageIntent =
  | { readonly kind: "command"; readonly command: CustomerCommand }
  | { readonly kind: "remove"; readonly number: number }
  | { readonly kind: "items"; readonly result: ParseResult };

/**
 * بتوزّع الرسالة الواردة أثناء التصفّح. **الترتيب جزء من الصحة:**
 *
 *   1. الأوامر الأربعة — مطابقة الرسالة كاملة
 *   2. `شيل <رقم>` — مرساة
 *   3. محلّل الأصناف
 *
 * 🔴 لو مرق المحلّل قبلهم، «شيل 2» بتضيف الصنف 2 وبتقول «شيل غير واضح» —
 *    **الزبون طلب حذفا فصار إضافة**، وسلّة غلط بتوصل المطبخ بلا ولا رسالة خطأ.
 *    الترتيب محقّق هون بنيويا: الدالة وحدة، والرجوع متسلسل.
 */
export function interpretMessage(raw: string, menuMap: MenuMap): MessageIntent {
  const command = matchCommand(raw);
  if (command !== null) return { kind: "command", command };

  const remove = REMOVE_COMMAND.exec(normalizeArabic(raw));
  if (remove !== null) return { kind: "remove", number: Number(remove[1]) };

  return { kind: "items", result: parseItems(raw, menuMap) };
}
