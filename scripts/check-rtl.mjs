/**
 * pnpm check:rtl — brief I §1, items 1 and 2. The dashboard is laid out right
 * to left by `dir="rtl"` on <html> alone, with logical properties.
 *
 * Fails, by file and line, on any of these in apps/dashboard-web (.css, .tsx,
 * .ts — node_modules and .next aside):
 *   1. Reversing the order to fix the direction: `flex-direction` or
 *      `flex-flow` with `row-reverse` / `column-reverse`, and `order:`.
 *      `dir="rtl"` already flips a row; reversing it on top flips it twice,
 *      and the bug only shows once the row becomes a column.
 *   2. A physical side: `margin-left/right` · `padding-left/right` · `left:`
 *      · `right:` · `border-left/right…` · `text-align: left/right` · `float`
 *      · `border-*-left/right-radius` — and the same in `style={{}}`
 *      (`marginLeft`…).
 *
 * A rare exception carries `rtl-ok: <why>` on the same line. Comments are not
 * code: a rule named in one is not a use of it.
 */
import { readFileSync } from "node:fs";
import { webSources } from "./web-sources.mjs";

/** [pattern, what it is] — CSS. */
const CSS_RULES = [
  [
    /(?:^|[\s;{])flex-(?:direction|flow)\s*:[^;}]*\b(?:row|column)-reverse\b/,
    "a reversed flex direction",
  ],
  [/(?:^|[\s;{])order\s*:/, "order:"],
  [/\b(?:margin|padding)-(?:left|right)\b/, "a physical margin or padding"],
  [/(?:^|[\s;{])(?:left|right)\s*:/, "left: or right:"],
  [/\bborder-(?:left|right)\b/, "a physical border side"],
  [
    /(?:^|[\s;{])text-align\s*:\s*(?:left|right)\b/,
    "text-align: left or right",
  ],
  [/(?:^|[\s;{])float\s*:/, "float"],
  [
    /\bborder-(?:top|bottom)-(?:left|right)-radius\b/,
    "a physical corner radius",
  ],
];

/** The same, as a React `style` object writes them. */
const TS_RULES = [
  [
    /\bflex(?:Direction|Flow)\s*:\s*["'`][^"'`]*-reverse/,
    "a reversed flex direction",
  ],
  [/\border\s*:\s*["'`]?-?\d/, "order:"],
  [/\b(?:margin|padding)(?:Left|Right)\b/, "a physical margin or padding"],
  [/\b(?:left|right)\s*:\s*["'`\d-]/, "left: or right:"],
  [/\bborder(?:Left|Right)/, "a physical border side"],
  [/\btextAlign\s*:\s*["'`](?:left|right)["'`]/, "text-align: left or right"],
  [/\b(?:cssFloat|float)\s*:\s*["'`]/, "float"],
  [/\bborder(?:Top|Bottom)(?:Left|Right)Radius\b/, "a physical corner radius"],
];

const EXCEPTION = /rtl-ok:\s*\S/;

/**
 * The source with its comments blanked out, line breaks kept so line numbers
 * still point at the file: `/* … *\/` everywhere, `//…` in TS.
 */
function withoutComments(src, ts) {
  const blank = (s) => s.replace(/[^\n]/g, " ");
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, blank);
  return ts ? noBlocks.replace(/(^|[^:"'`])\/\/.*$/gm, (_, p) => p) : noBlocks;
}

const failures = [];
const files = webSources(/\.(css|tsx|ts)$/);
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const css = file.endsWith(".css");
  const rules = css ? CSS_RULES : TS_RULES;
  const original = src.split("\n");
  withoutComments(src, !css)
    .split("\n")
    .forEach((code, i) => {
      if (EXCEPTION.test(original[i])) return;
      for (const [pattern, what] of rules)
        if (pattern.test(code))
          failures.push(`${file}:${i + 1} — ${what}: ${original[i].trim()}`);
    });
}

console.log(`${files.length} files of dashboard-web`);
if (failures.length) {
  for (const f of failures) console.error(`✗ ${f}`);
  console.error(
    `\n✗ check:rtl failed — ${failures.length} problem(s). Logical properties only ` +
      '(margin-inline-start…), and no reversing: dir="rtl" flips the row by itself. ' +
      "A rare exception: `rtl-ok: <why>` on the same line.",
  );
  process.exit(1);
}
console.log("✓ check:rtl");
