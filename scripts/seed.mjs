/** بيانات اختبار العزل. للتطوير والـCI فقط — أبدا على الإنتاج. */
import { psql } from "./psql.mjs";

if (process.env.NODE_ENV === "production") {
  console.error("✗ رفض: seed ممنوع على الإنتاج");
  process.exit(1);
}

// كلمات سر أدوار التطوير — بدونها `pnpm dev` بيفشل بـauthentication.
// التفاصيل الكاملة بأول db/seed/dev-role-passwords.sql
if (
  psql({ file: "db/seed/dev-role-passwords.sql", quiet: true }).status !== 0
) {
  console.error("✗ فشل ضبط كلمات سر أدوار التطوير");
  process.exit(1);
}

const r = psql({ file: "db/seed/chain-isolation-fixture.sql", quiet: true });

// كلمات سر الموظفين للتطوير — لازمة لـ/auth/login (S0-08).
if (
  psql({ file: "db/seed/dev-staff-passwords.sql", quiet: true }).status !== 0
) {
  console.error("✗ فشل زرع كلمات سر الموظفين");
  process.exit(1);
}
// رقم بشري لرسالة الاستسلام — مطعم أ وحده، عشان الفرعين موجودين بالتطوير.
// التفاصيل بأول db/seed/dev-contact-phone.sql
if (psql({ file: "db/seed/dev-contact-phone.sql", quiet: true }).status !== 0) {
  console.error("✗ فشل زرع رقم التواصل");
  process.exit(1);
}
// مطعم بيوصّل وآخر لأ — بدونه فرع التوصيل كله ما بينوصل له بالتطوير.
// التفاصيل بأول db/seed/dev-delivery.sql
if (psql({ file: "db/seed/dev-delivery.sql", quiet: true }).status !== 0) {
  console.error("✗ فشل زرع إعدادات التوصيل");
  process.exit(1);
}
process.exit(
  r.status === 0
    ? (console.log("✓ بيانات الاختبار + كلمات سر الأدوار انزرعت"), 0)
    : 1,
);
