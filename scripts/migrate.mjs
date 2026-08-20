/**
 * تشغيل الـmigrations بالترتيب الرقمي.
 *
 * مقصود إنه بسيط: الملفات append-only ومرقّمة، والتشغيل idempotent
 * (كل ملف بيبلش بـBEGIN وبينتهي بـCOMMIT، وإعادة التشغيل على قاعدة
 * فيها الجداول أصلا رح تفشل بصوت عالي — وهاد المطلوب، مش تجاهل صامت).
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { psql } from "./psql.mjs";

const dir = "db/migrations";
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
if (!files.length) {
  console.error("لا يوجد migrations");
  process.exit(1);
}

for (const f of files) {
  console.log(`→ ${f}`);
  const r = psql({ file: join(dir, f), quiet: true });
  if (r.status !== 0) {
    console.error(`✗ فشل: ${f}`);
    process.exit(1);
  }
}
console.log(`✓ ${files.length} migration اشتغلوا`);
