/**
 * The header and the pause strip (brief ي-ب §5): «المنيو» after «السجل»,
 * the page's tab on /menu and /menu/removed; the strip under the header on
 * every page, above «انقطع الاتصال», as that one looks and neutral, with a
 * 44px «استأنف». What is TSX is held by reading it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { isCurrentTab } from "../../shared/layout/tabs.ts";

const read = (path: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../${path}`, import.meta.url)),
    "utf8",
  );

/** The declarations of one top-level CSS rule, by its exact selector. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  assert.notEqual(at, -1, `no rule ${selector}`);
  return css.slice(at, css.indexOf("}", at));
}

const header = read("shared/layout/dashboard-header.tsx");
const headerCss = read("shared/layout/dashboard-header.module.css");
const strip = read("features/menu/components/orders-paused-strip.tsx");
const stripCss = read(
  "features/menu/components/orders-paused-strip.module.css",
);

test("🔴 «المنيو» is the page's tab on /menu and on /menu/removed; «الطلبات» and «السجل» as before", () => {
  assert.equal(isCurrentTab("/menu", "/menu"), true);
  assert.equal(isCurrentTab("/menu/removed", "/menu"), true);
  assert.equal(isCurrentTab("/menus", "/menu"), false);
  assert.equal(isCurrentTab("/orders", "/menu"), false);
  // As before: their own path alone — an order's page marks neither.
  assert.equal(isCurrentTab("/orders", "/orders"), true);
  assert.equal(isCurrentTab("/orders/x", "/orders"), false);
  assert.equal(isCurrentTab("/history", "/history"), true);
  assert.equal(isCurrentTab("/orders/x", "/history"), false);
  assert.equal(isCurrentTab("/menu/removed", "/orders"), false);
});

test("the header: three tabs, «المنيو» after «السجل», each marked by isCurrentTab", () => {
  const nav = header.slice(header.indexOf("<nav"), header.indexOf("</nav>"));
  const hrefs = [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ["/orders", "/history", "/menu"]);
  assert.ok(nav.indexOf("T.tabs.history") < nav.indexOf("T.tabs.menu"));
  for (const href of hrefs)
    assert.ok(nav.includes(`aria-current={current("${href}")}`), href);
  assert.match(header, /isCurrentTab\(pathname, href\) \? "page" : undefined/);
});

test("🔴 the strip sits under the header, above «انقطع الاتصال», on every page", () => {
  const at = (s: string) => header.indexOf(s);
  assert.ok(at("</header>") !== -1 && at("{strip}") > at("</header>"));
  assert.ok(at("{strip}") < at("{offline && ("));
  // Every page behind login: the dashboard's one layout fills the slot.
  assert.match(
    read("app/(dashboard)/layout.tsx"),
    /strip=\{<OrdersPausedStrip \/>\}/,
  );
  // Nothing while taking orders, or before the first read.
  assert.match(strip, /if \(!ordersPausedAt\) return null;/);
  assert.match(strip, /role="status"/);
});

test("the strip looks like «انقطع الاتصال» — neutral, never the accent — and «استأنف» is 44px", () => {
  const offline = rule(headerCss, ".offline");
  const own = rule(stripCss, ".strip");
  for (const decl of [
    "background: var(--surface);",
    "border-block-end: 1px solid var(--border);",
    "padding-block: 8px;",
    "font-size: 13px;",
    "font-weight: 600;",
    "color: var(--text-primary);",
  ]) {
    assert.ok(offline.includes(decl), `.offline: ${decl}`);
    assert.ok(own.includes(decl), `.strip: ${decl}`);
  }
  assert.doesNotMatch(
    stripCss.replace(/\/\*[\s\S]*?\*\//g, ""),
    /--accent/,
    "the strip is neutral",
  );
  // The header's width and edges.
  const bounds = rule(stripCss, ".bounds");
  assert.match(bounds, /max-width: var\(--page-width, none\);/);
  assert.match(bounds, /padding-inline: 18px;/);
  const resume = rule(stripCss, ".resume");
  assert.match(resume, /min-height: 44px;/);
  assert.match(resume, /white-space: nowrap;/);
  // Its text: the label and «منذ…», and «استأنف», working on aria-busy.
  assert.match(strip, /ordersPausedAr\(ordersPausedAt, readAt\)/);
  assert.match(strip, /\{T\.paused\.resume\}/);
  assert.match(strip, /aria-busy=\{busy\}/);
  assert.match(strip, /pauseChanged\(res\.value\.ordersPausedAt\)/);
});
