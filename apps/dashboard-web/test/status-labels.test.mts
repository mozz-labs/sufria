/**
 * بوابة نصوص الحالات للفرونت اند.
 *
 * سببها: النسخة المحلية بـmock.ts كانت فيها 4 حالات من 7، ونصوص شارات مكررة
 * inline بـpage.tsx. الحالتان الناقصتان (`accepted` / `completed`) ما كانتا
 * بتوقّعا شي — الواجهة بس كانت بتعرض حالة مش موجودة عندها كـundefined.
 * هالملف بيمنع الرجوع لهناك من الجهتين:
 *   1. كل حالة من السبعة إلها نص بـ@sufria/shared.
 *   2. ولا نص شارة مكتوب حرفيا جوّا apps/dashboard-web.
 *
 * المشغّل: `node --test` المدمج بـNode 24 (مع تجريد الأنواع الأصلي).
 * بلا تبعيات — لا Jest ولا Vitest بهالحزمة. ADR-004 بيمنع esbuild لأنه
 * بيكسر emitDecoratorMetadata، وهاي حزمة بلا ديكوريتورات وبلا حقن Nest،
 * فما فيها شي يتكسر أصلا.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ORDER_STATUSES,
  ORDER_STATUS_LABEL_AR,
  ORDER_STATUS_MESSAGE_AR,
  ORDER_CANCELLATION_REASON_SLOT,
  PAYMENT_STATUS_LABEL_AR,
} from "@sufria/shared";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url));
const APP_ROOT = join(TEST_DIR, "..");

// --- 1. الشارات السبعة -------------------------------------------------------

test("كل حالة طلب إلها شارة عربية غير فارغة", () => {
  assert.equal(ORDER_STATUSES.length, 7);
  for (const status of ORDER_STATUSES) {
    const label = ORDER_STATUS_LABEL_AR[status];
    assert.ok(
      typeof label === "string" && label.trim().length > 0,
      `الحالة ${status} بلا شارة بـORDER_STATUS_LABEL_AR`,
    );
  }
});

test("نص الشارات هو النص المعتمد بالضبط", () => {
  assert.deepEqual(ORDER_STATUS_LABEL_AR, {
    pending_acceptance: "معلّق",
    accepted: "مقبول",
    preparing: "قيد التحضير",
    ready: "جاهز",
    completed: "مكتمل",
    cancelled: "ملغى",
    expired: "غير مستلَم",
  });
});

test("ما في شارة زيادة على الحالات السبعة", () => {
  assert.deepEqual(
    Object.keys(ORDER_STATUS_LABEL_AR).sort(),
    [...ORDER_STATUSES].sort(),
  );
});

// --- 2. شارة الدفع ----------------------------------------------------------

test("collected لحالها إلها شارة دفع", () => {
  assert.equal(PAYMENT_STATUS_LABEL_AR.collected, "محصَّل");
});

test("pending_cash حالة حيّة بلا شارة — بقصد", () => {
  assert.ok(
    !("pending_cash" in PAYMENT_STATUS_LABEL_AR),
    "pending_cash لازم يضل بلا نص — غياب الشارة تصميم مش نقص",
  );
  assert.deepEqual(Object.keys(PAYMENT_STATUS_LABEL_AR), ["collected"]);
});

// --- 3. رسائل الزبون: مفردة منفصلة عن الشارات -------------------------------

test("رسائل الزبون مش نفس نصوص الشارات", () => {
  const labels = new Set(Object.values(ORDER_STATUS_LABEL_AR));
  const messages = [
    ORDER_STATUS_MESSAGE_AR.pending_acceptance,
    ORDER_STATUS_MESSAGE_AR.accepted,
    ORDER_STATUS_MESSAGE_AR.ready,
    ORDER_STATUS_MESSAGE_AR.cancelled.restaurant,
    ORDER_STATUS_MESSAGE_AR.cancelled.customer,
  ];
  for (const message of messages) {
    assert.ok(message.trim().length > 0);
    assert.ok(
      !labels.has(message),
      `«${message}» مستعملة كشارة وكرسالة — لازم يكونوا مفردتين منفصلتين`,
    );
  }
});

test("نص رسائل الزبون هو النص المعتمد", () => {
  assert.equal(
    ORDER_STATUS_MESSAGE_AR.pending_acceptance,
    "استلمنا طلبك — التأكيد خلال دقائق.",
  );
  assert.equal(ORDER_STATUS_MESSAGE_AR.accepted, "أكّدنا طلبك.");
  assert.equal(ORDER_STATUS_MESSAGE_AR.ready, "طلبك جاهز للاستلام.");
  assert.equal(
    ORDER_STATUS_MESSAGE_AR.cancelled.customer,
    "ألغينا الطلب حسب طلبك.",
  );
});

test("رسالة إلغاء المطعم فيها خانة سبب لازم تنستبدل", () => {
  assert.ok(
    ORDER_STATUS_MESSAGE_AR.cancelled.restaurant.includes(
      ORDER_CANCELLATION_REASON_SLOT,
    ),
    "رسالة إلغاء المطعم لازم تحتوي خانة السبب",
  );
  assert.ok(
    !ORDER_STATUS_MESSAGE_AR.cancelled.customer.includes(
      ORDER_CANCELLATION_REASON_SLOT,
    ),
    "إلغاء الزبون بلا سبب — ما إله خانة",
  );
});

test("preparing و completed بلا رسالة زبون — بقصد", () => {
  for (const status of ["preparing", "completed"] as const) {
    assert.ok(
      !(status in ORDER_STATUS_MESSAGE_AR),
      `${status} انضافت إلها رسالة زبون. هاد مش سهو ينصلح — اقرأ التعليق ` +
        `فوق ORDER_STATUS_MESSAGE_AR بـpackages/shared/src/domain.ts. ` +
        `بدها قرار منتج مكتوب، مش تعديل اختبار.`,
    );
  }
});

// --- 4. ولا نسخة محلية بالفرونت اند -----------------------------------------

function sourceFiles(): string[] {
  const out: string[] = [];
  const skip = new Set(["node_modules", ".next", "dist", "test", "public"]);
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (!skip.has(entry)) walk(full);
      } else if (/\.(ts|tsx)$/.test(entry) && entry !== "next-env.d.ts") {
        out.push(full);
      }
    }
  };
  walk(APP_ROOT);
  return out;
}

test("ولا شارة مكتوبة حرفيا جوّا dashboard-web", () => {
  const banned = [
    ...Object.values(ORDER_STATUS_LABEL_AR),
    ...Object.values(PAYMENT_STATUS_LABEL_AR),
  ].filter((v): v is string => typeof v === "string");

  const files = sourceFiles();
  assert.ok(files.length > 0, "ما لقي ولا ملف مصدر — الماشي غلط");

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const label of banned) {
      for (const quote of ['"', "'", "`"]) {
        assert.ok(
          !src.includes(`${quote}${label}${quote}`),
          `${relative(APP_ROOT, file)} فيه الشارة «${label}» مكتوبة حرفيا. ` +
            `النص مصدره @sufria/shared وبس — استورد ORDER_STATUS_LABEL_AR.`,
        );
      }
    }
  }
});

test("ولا خريطة حالات محلية ولا نوع OrderStatus محلي", () => {
  for (const file of sourceFiles()) {
    const src = readFileSync(file, "utf8");
    const where = relative(APP_ROOT, file);

    assert.ok(
      !/\btype\s+OrderStatus\b\s*=/.test(src),
      `${where} بيعرّف OrderStatus محليا. النوع المشترك بـ@sufria/shared ` +
        `فيه 7 قيم — النسخة المحلية القديمة كان فيها 4.`,
    );
    assert.ok(
      !/\bSTATUS_LABEL\b/.test(src),
      `${where} رجّع STATUS_LABEL. استعمل ORDER_STATUS_LABEL_AR من @sufria/shared.`,
    );
    assert.ok(
      !/Record<\s*OrderStatus\s*,\s*string\s*>/.test(src),
      `${where} بيعرّف خريطة نص محلية للحالات. النص مصدره @sufria/shared.`,
    );
  }
});

test("الواجهة فعلا بتستورد النصوص من @sufria/shared", () => {
  const page = readFileSync(join(APP_ROOT, "app/dashboard/page.tsx"), "utf8");
  assert.match(page, /from\s+"@sufria\/shared"/);
  assert.match(page, /\bORDER_STATUS_LABEL_AR\b/);

  const mock = readFileSync(join(APP_ROOT, "lib/mock.ts"), "utf8");
  assert.match(mock, /from\s+"@sufria\/shared"/);
});
