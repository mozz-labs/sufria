/**
 * The numbers' font stack (brief I-9 #1): Plex Mono, then Plex Sans Arabic,
 * then `monospace` — the digits Mono, the Arabic letters inside a number
 * («شيكل», «منذ») ours. Measured on the lab (Chrome, getPlatformFontsForNode):
 * those letters were drawn in Arial, the local face next/font generates as
 * Mono's fallback, which sat between the two. What decides it is two lines,
 * held here: the stack in `.num`, and no fallback face in `--font-mono`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../../app/", import.meta.url));
const css = readFileSync(`${APP}globals.css`, "utf8");
const layout = readFileSync(`${APP}layout.tsx`, "utf8");

test("the numbers' stack: Plex Mono, then Plex Sans Arabic, then monospace", () => {
  const at = css.indexOf("\n.num {");
  assert.notEqual(at, -1, "no .num rule in globals.css");
  const decl = /font-family:\s*([^;]+);/.exec(
    css.slice(at, css.indexOf("}", at)),
  );
  assert.equal(decl?.[1], "var(--font-mono), var(--font-sans), monospace");
});

test("--font-mono is Plex Mono alone — no generated fallback face before Plex Sans Arabic", () => {
  const at = layout.indexOf("IBM_Plex_Mono({");
  assert.notEqual(at, -1, "no IBM_Plex_Mono(...) in layout.tsx");
  const options = layout.slice(at, layout.indexOf("});", at));
  assert.match(options, /variable:\s*"--font-mono"/);
  // The webpack loader drops the face for this one…
  assert.match(options, /adjustFontFallback:\s*false/);
  // …and Turbopack, which builds the app, for this one alone (measured).
  assert.match(options, /fallback:\s*\[\]/);
});
