/**
 * Brief G §0: every visible text comes from one dictionary exported by
 * `@sufria/shared` — no text inline in the components. Held here the only
 * way a script can: no Arabic letter in the code of `app/` and `lib/`,
 * comments aside. A string the screen shows in Arabic can then only have
 * come from shared.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

/** The code without its comments: `//…`, `/* … *\/` and JSX `{/* … *\/}`. */
function withoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const ARABIC_LETTER = /[ء-ي]/u;

test("no Arabic text inline in app/ or lib/ — it comes from DASHBOARD_UI_AR", () => {
  const sources = [
    ...files(join(APP_ROOT, "app")),
    ...files(join(APP_ROOT, "lib")),
  ];
  assert.ok(sources.length >= 5, "the walk found nothing — it is broken");
  for (const file of sources) {
    const code = withoutComments(readFileSync(file, "utf8"));
    code.split("\n").forEach((line, i) => {
      assert.doesNotMatch(
        line,
        ARABIC_LETTER,
        `${relative(APP_ROOT, file)}:${i + 1} writes Arabic inline: «${line.trim()}». ` +
          `Add it to DASHBOARD_UI_AR in packages/shared/src/dashboard-ui.ts.`,
      );
    });
  }
});

test("🔴 the guard's own proof: an inline string is caught, a comment is not", () => {
  assert.match(withoutComments(`<p>{"مرحبا"}</p>`), ARABIC_LETTER);
  assert.doesNotMatch(withoutComments(`// مرحبا\nconst x = 1;`), ARABIC_LETTER);
  assert.doesNotMatch(withoutComments(`{/* مرحبا */}<p />`), ARABIC_LETTER);
});
