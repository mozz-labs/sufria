/**
 * بوابة التطبيع ومطابقة الأوامر — ب-1.
 *
 * المشغّل: `node --test` المدمج بـNode 24 (تجريد الأنواع الأصلي)، نفس نمط
 * `apps/dashboard-web`. بلا تبعيات: لا Jest ولا Vitest في هذه الحزمة، وليس
 * فيها ديكوريتورات ولا حقن Nest فلا شيء يكسره ADR-004 هنا.
 *
 * 🔴 هذا الملف كُتب لأن `packages/shared` كانت **بلا سكربت `test` إطلاقا**،
 *    وCI يشغّل `pnpm -r --if-present test` فكان يتخطّاها بصمت. اختبار مكتوب
 *    وغير مشغَّل أسوأ من اختبار غير مكتوب: يعطي طمأنينة كاذبة.
 *    السكربت أُضيف مع هذا الملف، وتحقّق بكسر متعمّد أن البوابة تحمرّ فعلا.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  normalizeArabic,
  matchCommand,
  COMMAND_INPUT_LISTS,
  FINISH_INPUTS,
  CART_INPUTS,
  MENU_INPUTS,
} from "@sufria/shared";

// ---------------------------------------------------------------------------
// 1. الخطوات السبع، خطوة خطوة
// ---------------------------------------------------------------------------

test("1. الهمزات أ إ آ بتصير ا", () => {
  assert.equal(normalizeArabic("إنهاء"), "انهاء");
  assert.equal(normalizeArabic("أحمد"), "احمد");
  assert.equal(normalizeArabic("آخر"), "اخر");
});

test("2. التاء المربوطة بتصير ه", () => {
  assert.equal(normalizeArabic("كفاية"), "كفايه");
  assert.equal(normalizeArabic("القائمة"), "القائمه");
});

test("3. الألف المقصورة بتصير ي", () => {
  assert.equal(normalizeArabic("مستشفى"), "مستشفي");
});

test("4. التشكيل والتطويل بينحذفوا", () => {
  assert.equal(normalizeArabic("تَمّ"), "تم");
  assert.equal(normalizeArabic("تــم"), "تم");
  assert.equal(normalizeArabic("شَاوِرْمَا"), "شاورما");
});

test("5. الأرقام العربية-الهندية بتصير غربية", () => {
  assert.equal(normalizeArabic("٥"), "5");
  assert.equal(normalizeArabic("٢ و٣"), "2 و3");
  assert.equal(normalizeArabic("٠١٢٣٤٥٦٧٨٩"), "0123456789");
});

test("6. المسافات المتعددة بتنقلّص لوحدة", () => {
  assert.equal(normalizeArabic("هيك    بس"), "هيك بس");
  assert.equal(normalizeArabic("هاد\tكل\nشي"), "هاد كل شي");
});

test("7. الترقيم والإيموجي بينقصّوا من الطرفين وبس", () => {
  assert.equal(normalizeArabic("تم."), "تم");
  assert.equal(normalizeArabic("تم 👍"), "تم");
  assert.equal(normalizeArabic("«تم»"), "تم");
  assert.equal(normalizeArabic("  تم  "), "تم");
  assert.equal(normalizeArabic("...تم!!!"), "تم");
  // 🔴 الداخل ما بينمسّ: مسافة `هاد كل شي` جوّانية وبتضل.
  assert.equal(normalizeArabic("🔥 هاد كل شي 🔥"), "هاد كل شي");
});

test("الأمثلة الأربعة المكتوبة بالبريف §3 بتطلع كما وُعد", () => {
  assert.equal(normalizeArabic("إنهاء"), normalizeArabic("انهاء"));
  assert.equal(normalizeArabic("تم."), normalizeArabic("تم"));
  assert.equal(normalizeArabic("تم 👍"), normalizeArabic("تم"));
  assert.equal(normalizeArabic("كفاية"), "كفايه");
});

test("التطبيع idempotent — تطبيق مرتين زي مرة", () => {
  for (const raw of ["إنهاء", "تم 👍", "كفاية", "٥ و٦", "  هيك   بس  "]) {
    assert.equal(normalizeArabic(normalizeArabic(raw)), normalizeArabic(raw));
  }
});

// ---------------------------------------------------------------------------
// 2. القوائم مخزّنة مطبَّعة
// ---------------------------------------------------------------------------

test("🔴 كل مدخل بالقوائم الثلاث نقطة ثابتة للتطبيع", () => {
  // مدخل غير مطبَّع ما بيطابق ولا رسالة أبدا: المدخل بينطبّع والقائمة لأ.
  // فشل صامت تام — ولهيك هالاختبار بيمشي على القوائم نفسها، مش على نسخة.
  for (const [listName, entries] of COMMAND_INPUT_LISTS) {
    for (const entry of entries) {
      assert.equal(
        normalizeArabic(entry),
        entry,
        `${listName}: «${entry}» مش مطبَّع — لازم «${normalizeArabic(entry)}»`,
      );
    }
  }
});

test("ولا مدخل مكرر بين القوائم الثلاث", () => {
  const seen = new Map<string, string>();
  for (const [listName, entries] of COMMAND_INPUT_LISTS) {
    for (const entry of entries) {
      const previous = seen.get(entry);
      assert.equal(
        previous,
        undefined,
        `«${entry}» موجود بـ${previous} و${listName} — أي أمر بيفوز؟`,
      );
      seen.set(entry, listName);
    }
  }
});

// ---------------------------------------------------------------------------
// 3. الموجب — تعريف الإنجاز في ب-1 حرفيا
// ---------------------------------------------------------------------------

test("تعريف الإنجاز: الستة المسمّاة بالبريف كلها بتنهي الطلب", () => {
  for (const raw of ["تم", "تم.", "تم 👍", "إنهاء", "انهاء", "هيك بس"]) {
    assert.equal(matchCommand(raw), "finish", `«${raw}» لازم تنهي الطلب`);
  }
});

test("كل مدخلات قائمة الإنهاء بتطابق", () => {
  for (const raw of FINISH_INPUTS) {
    assert.equal(matchCommand(raw), "finish", `«${raw}»`);
  }
});

test("مدخلات السلّة والمنيو بتطابق", () => {
  for (const raw of CART_INPUTS) assert.equal(matchCommand(raw), "cart", raw);
  for (const raw of MENU_INPUTS) assert.equal(matchCommand(raw), "menu", raw);
  // وبأشكالها غير المطبَّعة كما بتوصل من الزبون فعلا:
  assert.equal(matchCommand("سلة"), "cart");
  assert.equal(matchCommand("القائمة"), "menu");
  assert.equal(matchCommand("منيو!"), "menu");
});

// ---------------------------------------------------------------------------
// 4. 🔴 السالبان — الخطأ الصامت رقم 1 في §9
//
//    الاثنان ما بيسقّطوا ولا اختبار قائم لو انكتبت المطابقة بـ`includes`.
//    مكتوبان هون **كل واحد باسمه** كما طلب البريف بالحرف.
// ---------------------------------------------------------------------------

test("🔴 سالب: «بدي شاورما بس بدون بصل» ما بتنهي الطلب", () => {
  // بتحتوي «بس». زبون **عم يطلب** — إنهاؤه هون بيقفل طلبا ناقصا بلا رسالة خطأ.
  assert.equal(matchCommand("بدي شاورما بس بدون بصل"), null);
});

test("🔴 سالب: «خلصت من الشغل هلق بدي اطلب» ما بتنهي الطلب", () => {
  // بتحتوي «خلصت». زبون **لسا ما بلّش** — إنهاؤه بيقفل سلّة فارغة.
  assert.equal(matchCommand("خلصت من الشغل هلق بدي اطلب"), null);
});

test("🔴 المطابقة على الرسالة كاملة: ولا مدخل بيطابق داخل جملة", () => {
  // الضابط العام ورا السالبين: أي مدخل + كلمة وحدة = مش أمر.
  for (const [, entries] of COMMAND_INPUT_LISTS) {
    for (const entry of entries) {
      assert.equal(matchCommand(`${entry} كمان`), null, `«${entry} كمان»`);
      assert.equal(matchCommand(`بدي ${entry}`), null, `«بدي ${entry}»`);
    }
  }
});

test("رسالة فاضية أو ترقيم أو إيموجي وحدها مش أمر", () => {
  for (const raw of ["", "   ", "...", "👍", "؟؟؟", "\n\t"]) {
    assert.equal(matchCommand(raw), null, JSON.stringify(raw));
  }
});

test("رقم صنف مش أمر — بيروح للمحلّل بـب-3", () => {
  for (const raw of ["2", "٢", "2 و5", "2 ×3"]) {
    assert.equal(matchCommand(raw), null, raw);
  }
});

// ---------------------------------------------------------------------------
// 5. حارسان بنيويان — القاعدتان اللي بتنكسرا بصمت
// ---------------------------------------------------------------------------

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SCANNED = ["packages/shared/src", "apps/conversation-engine/src"];

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".ts")) out.push(full);
    }
  };
  for (const rel of SCANNED) walk(join(REPO_ROOT, rel));
  return out;
}

test("🔴 ولا نسخة ثانية من التطبيع بأي مكان", () => {
  // نسخة ثانية معناها قائمة مطبَّعة بقاعدة ومدخل بقاعدة تانية — فشل صامت.
  // توقيع النسخة المكررة: استبدال على الهمزات. المصدر الوحيد المسموح
  // هو normalize.ts نفسه.
  const signature = /\[أإآ\]/u;
  for (const file of sourceFiles()) {
    const rel = relative(REPO_ROOT, file);
    if (rel.endsWith("packages/shared/src/normalize.ts")) continue;
    assert.ok(
      !signature.test(readFileSync(file, "utf8")),
      `${rel} فيه تطبيع همزات — استورد normalizeArabic بدل ما تكتب نسخة`,
    );
  }
});

test("🔴 ممنوع toLocaleString و Intl.NumberFormat — §11.5", () => {
  // `check:numerals` **بوابة غير مكتوبة** (§11.5). هالقاعدة بديلها القابل
  // للفحص: كل رقم بينصاغ بـtoFixed أو قالب نصي. الاثنتان تحت بتطلّعا أرقاما
  // عربية-هندية حسب locale المضيف، وبتكسرا «الأرقام غربية فقط» بصمت تام.
  for (const file of sourceFiles()) {
    const source = readFileSync(file, "utf8");
    const rel = relative(REPO_ROOT, file);
    assert.ok(!source.includes("toLocaleString"), `${rel}: toLocaleString`);
    assert.ok(
      !source.includes("Intl.NumberFormat"),
      `${rel}: Intl.NumberFormat`,
    );
  }
});
