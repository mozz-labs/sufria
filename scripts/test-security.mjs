/**
 * 🔴 البوابة الأمنية الإلزامية لـSprint 0.
 * بترجع 1 لو أي assertion فشل. blocking على main.
 */
import { spawnSync } from "node:child_process";
import { psql } from "./psql.mjs";

console.log("\n=== 1/2 اختبار عزل السلاسل ===");
if (
  psql({ file: "tests/security/chain-isolation.sql", quiet: true }).status !== 0
) {
  console.error("\n✗ بوابة العزل حمرا. ممنوع الدمج.");
  process.exit(1);
}

console.log(
  "\n=== 2/2 الضوابط السالبة (بتتأكد إن البوابة بتكشف كسر حقيقي) ===",
);
const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
const r = spawnSync("bash", ["tests/security/negative-controls.sh"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});
if (r.status !== 0) {
  console.error("\n✗ الضوابط السالبة فشلت — يعني البوابة نفسها مش موثوقة.");
  process.exit(1);
}
console.log("\n✓ البوابة الأمنية خضرا");
