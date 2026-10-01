/**
 * The contrast gate's logic (brief G §3, G-1): the pairs come from the token
 * source, the locked values pass, and the brief's break control — «جاهز» text
 * at #E0C060 — fails by the name of its pair.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  COLOR_MODES,
  COLOR_TOKENS,
  MIN_TEXT_CONTRAST,
  ORDER_STATUSES,
  STATUS_BADGE_COLORS,
  TEXT_ON_BACKGROUND,
  checkedTextVariables,
  contrastPairs,
  contrastRatio,
  designTokensCss,
} from "@sufria/shared";

test("contrastRatio: the WCAG endpoints", () => {
  assert.equal(contrastRatio("#000000", "#FFFFFF"), 21);
  assert.equal(contrastRatio("#FFFFFF", "#FFFFFF"), 1);
  assert.equal(contrastRatio("#FFFFFF", "#000000"), 21);
  assert.throws(() => contrastRatio("#FFF", "#000000"));
});

test("every locked pair passes 4.5:1, and the weakest is 5.00 (expired, light)", () => {
  const pairs = contrastPairs();
  for (const p of pairs)
    assert.ok(p.ratio >= MIN_TEXT_CONTRAST, `${p.name}: ${p.ratio.toFixed(2)}`);
  const weakest = pairs.reduce((a, b) => (b.ratio < a.ratio ? b : a));
  assert.equal(weakest.name, "light · badge expired");
  assert.equal(weakest.ratio.toFixed(2), "5.00");
});

test("the pairs are enumerated from the source: every badge × both modes", () => {
  const names = new Set(contrastPairs().map((p) => p.name));
  for (const mode of COLOR_MODES)
    for (const status of ORDER_STATUSES)
      assert.ok(names.has(`${mode} · badge ${status}`), `${mode} ${status}`);
  const textPairs = Object.values(TEXT_ON_BACKGROUND).reduce(
    (n, bgs) => n + (bgs?.length ?? 0),
    0,
  );
  assert.equal(
    contrastPairs().length,
    COLOR_MODES.length * (textPairs + ORDER_STATUSES.length),
  );
});

test("🔴 break control: «جاهز» text at #E0C060 fails, by the name of its pair", () => {
  const broken = structuredClone(STATUS_BADGE_COLORS);
  broken.ready.light.text = "#E0C060";
  const failing = contrastPairs(
    COLOR_TOKENS,
    TEXT_ON_BACKGROUND,
    broken,
  ).filter((p) => p.ratio < MIN_TEXT_CONTRAST);
  assert.deepEqual(
    failing.map((p) => p.name),
    ["light · badge ready"],
  );
});

test("🔴 text-muted (light) and accent (dark) are not text colours — they miss 4.5:1", () => {
  // Why TEXT_ON_BACKGROUND leaves them out. If a token change ever lifts
  // them over 4.5, this test says so, and they can become text colours.
  assert.ok(
    contrastRatio(
      COLOR_TOKENS.light["text-muted"],
      COLOR_TOKENS.light.surface,
    ) < MIN_TEXT_CONTRAST,
  );
  assert.ok(
    contrastRatio(COLOR_TOKENS.dark.accent, COLOR_TOKENS.dark.surface) <
      MIN_TEXT_CONTRAST,
  );
  assert.ok(!("text-muted" in TEXT_ON_BACKGROUND));
  assert.ok(!("accent" in TEXT_ON_BACKGROUND));
  assert.ok(!checkedTextVariables().includes("--text-muted"));
});

test("designTokensCss: every token, light by default and dark by the device", () => {
  const css = designTokensCss();
  const [light, dark] = css.split("@media (prefers-color-scheme: dark)");
  for (const [token, value] of Object.entries(COLOR_TOKENS.light))
    assert.ok(light!.includes(`--${token}:${value};`), token);
  for (const [token, value] of Object.entries(COLOR_TOKENS.dark))
    assert.ok(dark!.includes(`--${token}:${value};`), token);
  for (const status of ORDER_STATUSES) {
    assert.ok(
      light!.includes(
        `--badge-${status}-text:${STATUS_BADGE_COLORS[status].light.text};`,
      ),
    );
    assert.ok(
      dark!.includes(
        `--badge-${status}-bg:${STATUS_BADGE_COLORS[status].dark.bg};`,
      ),
    );
  }
});
