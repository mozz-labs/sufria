/**
 * The menu screen as drawn (brief ي-ب §6, decisions 1–6). What decides the
 * press needs a browser; what decides the page does not, and is held here
 * by reading the TSX and the CSS, as the orders card's link is.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../${path}`, import.meta.url)),
    "utf8",
  );
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of one top-level CSS rule, by its exact selector. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  assert.notEqual(at, -1, `no rule ${selector}`);
  return css.slice(at + selector.length + 3, css.indexOf("}", at)).trim();
}

const C = "features/menu/components/";
const screen = read(`${C}menu-screen.tsx`);
const row = read(`${C}menu-row.tsx`);
const add = read(`${C}add-item-form.tsx`);

test("🔴 «أوقف الطلبات مؤقتا» and its line only while taking orders — the strip's «استأنف» is then the one button", () => {
  const at = screen.indexOf("{ordersPausedAt === null && (");
  assert.notEqual(at, -1);
  const block = screen.slice(at, screen.indexOf("</div>", at));
  assert.match(block, /\{T\.menu\.pause\}/);
  assert.match(block, /\{T\.menu\.pauseHint\}/);
  // No dialog for it: the press sends, and the answer shows the strip.
  assert.match(screen, /ordersPauseApi\.setPaused\(true\)/);
  assert.match(screen, /pauseChanged\(res\.value\.ordersPausedAt\)/);
  assert.equal((screen.match(/T\.paused\.resume/g) ?? []).length, 0);
});

test("«المطفأة» and «شغّل الكل» only while an item is off; «شغّل الكل» asks first, with the count", () => {
  assert.match(screen, /\{off > 0 && \(/);
  assert.match(screen, /enableAllBodyAr\(asking\.count\)/);
  assert.match(screen, /menuApi\.enableAll\(\)/);
});

test("the screen's tabs look like the header's", () => {
  const header = code(read("shared/layout/dashboard-header.module.css"));
  const tabs = code(read(`${C}menu-tabs.module.css`));
  const own = rule(tabs, ".tab");
  for (const decl of rule(header, ".tab")
    .split("\n")
    .map((d) => d.trim()))
    assert.ok(own.includes(decl), `.tab: ${decl}`);
  assert.equal(
    rule(tabs, '.tab[aria-current="page"]'),
    rule(header, '.tab[aria-current="page"]'),
  );
});

test("🔴 every field has its label, and the price brings the decimal keyboard", () => {
  for (const [name, src] of [
    ["menu-row.tsx", row],
    ["add-item-form.tsx", add],
  ] as const) {
    const fields = [...src.matchAll(/<(input|select)\b/g)].length;
    const labelled = [
      ...src.matchAll(
        /<label\b[^>]*>\s*<span className=\{styles\.label\}>\{T\.menu\.fields\.\w+\}<\/span>\s*<(input|select)\b/g,
      ),
    ].length;
    assert.equal(labelled, fields, `${name}: a field without its label`);
    assert.match(src, /inputMode="decimal"/, name);
  }
});

test("🔴 the row in edit: «حفظ» and «إلغاء» always shown, «لم يُحفظ» by isUnsaved, Enter saves and Esc cancels", () => {
  const edit = row.slice(
    row.indexOf("if (draft) {"),
    row.indexOf("\n  return (\n    <li"),
  );
  assert.match(edit, /<form[\s\S]*onSubmit=\{save\}/);
  assert.match(edit, /e\.key === "Escape"[\s\S]*cancel\(\)/);
  assert.match(edit, /type="submit"[\s\S]*\{T\.menu\.save\}/);
  assert.match(edit, /onClick=\{cancel\}[\s\S]*\{T\.menu\.cancel\}/);
  // Neither is ever disabled for want of a change: «حفظ» waits while it
  // sends alone.
  assert.match(
    edit,
    /disabled=\{busy === "save"\}\s*aria-busy=\{busy === "save"\}/,
  );
  assert.match(edit, /const unsaved = isUnsaved\(item, draft\);/);
  assert.match(
    edit,
    /\{unsaved && \(?\s*<span className=\{styles\.unsaved\}>\{T\.menu\.unsaved\}<\/span>\s*\)?\}/,
  );
});

test("🔴 nothing on the screen changes before the API answers: the row takes the answer's item", () => {
  const toggle = row.slice(
    row.indexOf("async function toggle()"),
    row.indexOf("function edit()"),
  );
  const busy = toggle.indexOf('setBusy("toggle")');
  const sent = toggle.indexOf("await menuApi.updateItem(");
  const shown = toggle.indexOf("onChanged(res.value)");
  assert.ok(busy !== -1 && busy < sent && sent < shown);
  assert.match(row, /aria-busy=\{busy === "toggle"\}/);
});

test("the confirmations are built on shared/ui/dialog.tsx, «رجوع» being cancel.back", () => {
  const dialog = read(`${C}confirm-dialog.tsx`);
  assert.match(dialog, /from "\.\.\/\.\.\/\.\.\/shared\/ui\/dialog\.tsx"/);
  assert.match(dialog, /\{T\.cancel\.back\}/);
  assert.match(dialog, /aria-busy=\{busy\}/);
  assert.match(screen, /removeTitleAr\(asking\.item\.name\)/);
  assert.match(screen, /\{ archived: true \}/);
});
