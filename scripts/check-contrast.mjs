/**
 * pnpm check:contrast — brief G §3 (G-1).
 *
 * 1. Every text-on-background pair, enumerated from the token source in
 *    packages/shared/src/design-tokens.ts (not a list kept here), in both
 *    modes, must reach 4.5:1.
 * 2. No colour reaches dashboard-web around that source: no raw hex, and no
 *    `color:` other than a variable the pairs above checked. Without this half
 *    a component could paint text in `--text-muted` and the pairs would still
 *    pass without ever having looked at it.
 *
 * Reads the compiled shared package: the npm script builds it first.
 */
import { readFileSync } from "node:fs";
import {
  MIN_TEXT_CONTRAST,
  checkedTextVariables,
  contrastPairs,
} from "../packages/shared/dist/index.js";
import { webSources } from "./web-sources.mjs";

const failures = [];

const pairs = contrastPairs();
for (const p of pairs) {
  const line = `${p.ratio.toFixed(2).padStart(5)}:1  ${p.name}  (${p.text} on ${p.background})`;
  if (p.ratio < MIN_TEXT_CONTRAST) failures.push(`below 4.5:1 — ${line}`);
}
const weakest = pairs.reduce((a, b) => (b.ratio < a.ratio ? b : a));
console.log(
  `${pairs.length} pairs checked · weakest ${weakest.ratio.toFixed(2)}:1 (${weakest.name})`,
);

const allowed = new Set(checkedTextVariables());
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
// `color:` alone — not `background-color:` or `border-color:`.
const COLOR_DECL = /(?<![\w-])color\s*:\s*([^;}\n]+)/g;
const COLOR_KEY = /(?<![\w-])color\s*:\s*["'`]?([^,"'`}\n]+)/g;

for (const file of webSources(/\.(css|tsx|ts)$/)) {
  if (file.includes("/test/")) continue;
  const src = readFileSync(file, "utf8");
  src.split("\n").forEach((text, i) => {
    const where = `${file}:${i + 1}`;
    for (const m of text.matchAll(HEX))
      failures.push(`raw hex ${m[0]} — ${where} (use a token variable)`);
    const decl = file.endsWith(".css") ? COLOR_DECL : COLOR_KEY;
    for (const m of text.matchAll(decl)) {
      const value = m[1].trim();
      if (value === "inherit" || value === "currentColor") continue;
      const v = /^var\((--[\w-]+)\)$/.exec(value);
      if (!v || !allowed.has(v[1]))
        failures.push(
          `color: ${value} — ${where} (text colours: ${[...allowed].join(", ")})`,
        );
    }
  });
}

if (failures.length) {
  for (const f of failures) console.error(`✗ ${f}`);
  console.error(`\n✗ check:contrast failed — ${failures.length} problem(s)`);
  process.exit(1);
}
console.log("✓ check:contrast");
