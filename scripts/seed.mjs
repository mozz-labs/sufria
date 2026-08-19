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
process.exit(
  r.status === 0
    ? (console.log("✓ بيانات الاختبار + كلمات سر الأدوار انزرعت"), 0)
    : 1,
);
