/**
 * pnpm check:budget — brief I-9b #5, Mohammed's rule (CLAUDE.md,
 * «Performance»): a fixed size budget per page of the dashboard. It never
 * goes up; every improvement brings it down.
 *
 * For /login · /orders · /history · /orders/[id] · /menu · /menu/removed
 * (the last two since brief ي-ب), read from the production
 * build (apps/dashboard-web/.next), what a browser loads before its first
 * paint:
 *   - JS: Next's root files (build-manifest.json) and the page's own entry
 *     chunks, its layouts' included (page_client-reference-manifest.js),
 *     counted gzip-compressed, as `next start` sends them. The noModule
 *     polyfills a modern browser never downloads are left out.
 *   - fonts: the files next/font preloads for the page
 *     (next-font-manifest.json), woff2 as sent. A subset the browser asks for
 *     later, when a glyph needs it, is not counted.
 *   - total: the two.
 * Fails when a page is over its budget in apps/dashboard-web/perf-budget.json,
 * naming the page and the numbers.
 *
 * Cross-checked against the prerendered HTML of the static pages: if the
 * manifests stop matching what the HTML loads, it fails rather than count
 * the wrong thing.
 *
 * Needs a fresh production build — the npm script builds shared and the app
 * first. Not in verify (a build); run at the end of every brief and before
 * every merge. `--write` sets the budget to today's measure: Mohammed's
 * decision only.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { runInNewContext } from "node:vm";

const WEB = new URL("../apps/dashboard-web/", import.meta.url);
const NEXT = new URL(".next/", WEB);
const BUDGET = new URL("perf-budget.json", WEB);

/** route → its app directory, and its prerendered HTML when static. */
const PAGES = {
  "/login": { dir: "login", html: "login.html" },
  "/orders": { dir: "(dashboard)/orders", html: "orders.html" },
  "/history": { dir: "(dashboard)/history", html: "history.html" },
  "/orders/[id]": { dir: "(dashboard)/orders/[id]", html: null },
  "/menu": { dir: "(dashboard)/menu", html: "menu.html" },
  "/menu/removed": {
    dir: "(dashboard)/menu/removed",
    html: "menu/removed.html",
  },
};

const read = (path) => readFileSync(new URL(path, NEXT));
const json = (path) => JSON.parse(read(path).toString("utf8"));

if (!existsSync(new URL("BUILD_ID", NEXT))) {
  console.error(
    "✗ check:budget — no production build in apps/dashboard-web/.next. Run `pnpm check:budget`, which builds first.",
  );
  process.exit(1);
}

const failures = [];
const root = json("build-manifest.json").rootMainFiles;
const polyfills = new Set(json("build-manifest.json").polyfillFiles);
const fontManifest = json("server/next-font-manifest.json").app;

/** The page's entry chunks and preloaded fonts, from the manifests. */
function fromManifests(route, dir) {
  const context = { globalThis: {} };
  context.globalThis = context;
  runInNewContext(
    read(`server/app/${dir}/page_client-reference-manifest.js`).toString(
      "utf8",
    ),
    context,
  );
  const manifest = context.__RSC_MANIFEST[`/${dir}/page`];
  if (!manifest) throw new Error(`${route}: no client manifest for /${dir}`);
  const js = new Set(root);
  for (const files of Object.values(manifest.entryJSFiles))
    for (const f of files) js.add(f);
  const pageKey = Object.keys(fontManifest).find((k) =>
    k.endsWith(`/app/${dir}/page`),
  );
  if (!pageKey) throw new Error(`${route}: no font entry for /${dir}`);
  return { js: [...js], fonts: [...new Set(fontManifest[pageKey])] };
}

/** What the prerendered HTML loads: its scripts (bar noModule) and font preloads. */
function fromHtml(html) {
  const text = read(`server/app/${html}`).toString("utf8");
  const js = [...text.matchAll(/<script src="\/_next\/([^"]+)"([^>]*)>/g)]
    .filter(([, , attrs]) => !/noModule/i.test(attrs))
    .map(([, path]) => path);
  const fonts = [
    ...text.matchAll(/<link rel="preload" href="\/_next\/([^"]+\.woff2)"/g),
  ].map(([, path]) => path);
  return { js, fonts };
}

const same = (a, b) =>
  a.length === b.length &&
  [...a].sort().every((x, i) => x === [...b].sort()[i]);

const measured = {};
for (const [route, { dir, html }] of Object.entries(PAGES)) {
  const page = fromManifests(route, dir);
  page.js = page.js.filter((f) => !polyfills.has(f));
  if (html) {
    const seen = fromHtml(html);
    if (!same(page.js, seen.js) || !same(page.fonts, seen.fonts))
      failures.push(
        `${route}: the manifests no longer match what its HTML loads — JS ${page.js.length} vs ${seen.js.length}, fonts ${page.fonts.length} vs ${seen.fonts.length}`,
      );
  }
  const js = page.js.reduce((n, f) => n + gzipSync(read(f)).length, 0);
  const fonts = page.fonts.reduce((n, f) => n + read(f).length, 0);
  measured[route] = { js, fonts, total: js + fonts };
}

const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;

if (process.argv.includes("--write")) {
  writeFileSync(
    BUDGET,
    JSON.stringify(
      {
        rule: "The budget only comes down. It goes up by Mohammed's decision alone (brief I-9b #5).",
        unit: "bytes: JS gzip-compressed, fonts as woff2, loaded before the first paint",
        pages: measured,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("✓ perf-budget.json written from today's build");
}

if (!existsSync(BUDGET)) {
  console.error("✗ check:budget — no apps/dashboard-web/perf-budget.json");
  process.exit(1);
}
const budget = JSON.parse(readFileSync(BUDGET, "utf8")).pages;
for (const [route, m] of Object.entries(measured)) {
  const b = budget[route];
  if (!b) {
    failures.push(`${route}: no budget in perf-budget.json`);
    continue;
  }
  console.log(
    `${route.padEnd(12)} JS ${kib(m.js)} / ${kib(b.js)} · fonts ${kib(m.fonts)} / ${kib(b.fonts)} · total ${kib(m.total)} / ${kib(b.total)}`,
  );
  for (const part of ["js", "fonts", "total"])
    if (m[part] > b[part])
      failures.push(
        `${route}: ${part} ${kib(m[part])} over its budget of ${kib(b[part])} (+${m[part] - b[part]} bytes)`,
      );
}

if (failures.length) {
  for (const f of failures) console.error(`✗ ${f}`);
  console.error(`\n✗ check:budget failed — ${failures.length} problem(s)`);
  process.exit(1);
}
console.log("✓ check:budget");
