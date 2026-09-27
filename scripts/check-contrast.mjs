/**
 * pnpm check:contrast — brief G §3 (G-1).
 *
 * Every text-on-background pair, enumerated from the token source in
 * packages/shared/src/design-tokens.ts (not a list kept here), in both modes,
 * must reach 4.5:1.
 *
 * Reads the compiled shared package: the npm script builds it first.
 */
import {
  MIN_TEXT_CONTRAST,
  contrastPairs,
} from "../packages/shared/dist/index.js";

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

if (failures.length) {
  for (const f of failures) console.error(`✗ ${f}`);
  console.error(`\n✗ check:contrast failed — ${failures.length} problem(s)`);
  process.exit(1);
}
console.log("✓ check:contrast");
