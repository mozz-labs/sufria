/**
 * Scrollbars (brief I-9b #2): every box that scrolls inside the page has a
 * thin bar in the tokens' grey, light and dark — never the browser's wide
 * default. Measured on the lab: the conversation's was 10px in --text-muted;
 * the cancel field's, 15px in the default colours.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = fileURLToPath(new URL("../../", import.meta.url));
const THIN = /scrollbar-width: thin;/;
const TOKENS = /scrollbar-color: var\(--text-muted\) transparent;/;

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return path.endsWith(".css") ? [path] : [];
  });
}

test("every rule that scrolls inside the page has the thin bar in the tokens' grey", () => {
  const files = ["app", "features", "shared"].flatMap((d) =>
    cssFiles(join(WEB, d)),
  );
  let scrollers = 0;
  for (const file of files) {
    const css = readFileSync(file, "utf8");
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const [, selector, body] = m as unknown as [string, string, string];
      if (!/overflow(-[xy])?: (auto|scroll)/.test(body)) continue;
      scrollers++;
      const where = `${file.slice(WEB.length)} ${selector.trim()}`;
      assert.match(body, THIN, `${where}: scrollbar-width: thin`);
      assert.match(body, TOKENS, `${where}: the tokens' grey`);
    }
  }
  // The conversation's messages, at the least.
  assert.ok(scrollers >= 1, "no scroll box found — the test reads nothing");
});

test("what scrolls by the browser's own rules — the dialog and its field — too", () => {
  const css = readFileSync(join(WEB, "app/globals.css"), "utf8");
  const at = css.indexOf("\ntextarea,\ndialog {");
  assert.notEqual(at, -1, "no textarea, dialog rule in globals.css");
  const body = css.slice(at, css.indexOf("}", at));
  assert.match(body, THIN);
  assert.match(body, TOKENS);
});
