/** ينتظر Postgres يصير جاهز فعلا، مش بس الكونتينر يشتغل. */
import { spawnSync } from "node:child_process";

const DEADLINE = Date.now() + 60_000;
process.stdout.write("بانتظار قاعدة البيانات");
while (Date.now() < DEADLINE) {
  const r = spawnSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "pg_isready",
      "-U",
      "postgres",
      "-d",
      "wafa",
    ],
    { stdio: "ignore" },
  );
  if (r.status === 0) {
    console.log(" ✓ جاهزة");
    process.exit(0);
  }
  process.stdout.write(".");
  await new Promise((r) => setTimeout(r, 1500));
}
console.error(
  "\n✗ قاعدة البيانات ما جهزت خلال 60 ثانية. جرّب: docker compose logs postgres",
);
process.exit(1);
