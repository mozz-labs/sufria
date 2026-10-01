/**
 * pnpm check:numerals — brief G §3 (G-1). Western digits only (0-9), locked.
 *
 * Fails on any Arabic-Indic (U+0660–0669) or Extended Arabic-Indic
 * (U+06F0–06F9) digit in:
 *   1. every string exported by @sufria/shared, walked through its objects
 *      and arrays — every dictionary the screen and the customer read;
 *   2. every hand-written file of apps/dashboard-web.
 *
 * Not the source text of packages/shared: normalize.ts holds those digits on
 * purpose, to turn a customer's «٥» into 5 on the way in.
 *
 * Reads the compiled shared package: the npm script builds it first.
 */
import { readFileSync } from "node:fs";
import * as shared from "../packages/shared/dist/index.js";
import { webSources } from "./web-sources.mjs";

const EASTERN_DIGIT = /[٠-٩۰-۹]/u;
const failures = [];
let strings = 0;

function walk(value, path, seen) {
  if (typeof value === "string") {
    strings++;
    if (EASTERN_DIGIT.test(value)) failures.push(`${path} — «${value}»`);
    return;
  }
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  if (value instanceof RegExp) return;
  seen.add(value);
  for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`, seen);
}

const seen = new Set();
for (const [name, value] of Object.entries(shared)) walk(value, name, seen);

const files = webSources(/\.(css|tsx|ts|mts|mjs|json)$/);
for (const file of files) {
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((text, i) => {
      if (EASTERN_DIGIT.test(text))
        failures.push(`${file}:${i + 1} — ${text.trim()}`);
    });
}

console.log(
  `${strings} exported strings of @sufria/shared · ${files.length} files of dashboard-web`,
);
if (failures.length) {
  for (const f of failures) console.error(`✗ Eastern digit: ${f}`);
  console.error(`\n✗ check:numerals failed — ${failures.length} problem(s)`);
  process.exit(1);
}
console.log("✓ check:numerals");
