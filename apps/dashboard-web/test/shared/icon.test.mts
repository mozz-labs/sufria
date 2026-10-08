/**
 * The tab's icon (brief I-9b #3, Mohammed's decision): a sumac square with
 * rounded corners and nothing on it — no drawing, letter or logo — in the
 * accent token, light and dark, by the SVG's own prefers-color-scheme. An
 * icon outside the page reads no CSS variable, so the two values are written
 * out; this holds them to design-tokens.ts. Next.js's default icon is gone.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { COLOR_TOKENS } from "@sufria/shared";

const APP = fileURLToPath(new URL("../../app/", import.meta.url));
const svg = readFileSync(`${APP}icon.svg`, "utf8").replace(
  /<!--[\s\S]*?-->/g,
  "",
);

test("the icon is the accent token: light by default, dark by its own media query", () => {
  const light = new RegExp(`rect \\{ fill: ${COLOR_TOKENS.light.accent}; \\}`);
  const dark = new RegExp(
    `@media \\(prefers-color-scheme: dark\\) \\{ rect \\{ fill: ${COLOR_TOKENS.dark.accent}; \\} \\}`,
  );
  assert.match(svg, light);
  assert.match(svg, dark);
  // No other colour anywhere in it.
  assert.deepEqual(
    [...new Set(svg.match(/#[0-9a-fA-F]{3,8}\b/g))].sort(),
    [COLOR_TOKENS.dark.accent, COLOR_TOKENS.light.accent].sort(),
  );
});

test("a square with rounded corners, and nothing drawn on it", () => {
  const shapes = svg.match(/<(?!\/)(?!svg\b)(?!style\b)[a-zA-Z]+/g) ?? [];
  assert.deepEqual(shapes, ["<rect"]);
  assert.match(svg, /<rect width="32" height="32" rx="\d+"\/>/);
  assert.match(svg, /viewBox="0 0 32 32"/);
});

test("Next.js's default icon is gone", () => {
  assert.equal(existsSync(`${APP}favicon.ico`), false);
});
