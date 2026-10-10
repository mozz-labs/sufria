/**
 * The next step's press (brief I-9b #6, Mohammed's decision): the button
 * shows at once that it is working — darker, a thin running line in the
 * tokens' colours, its word unchanged, no new text — and the order on the
 * screen changes only from the server's answer: no badge, no status before.
 *
 * Brief ي-ب §2 (Mohammed, 8 October) reversed one part of I-9b #6: the look
 * is on `aria-busy="true"`, which the working button carries, and no longer
 * on `:disabled` — so a button disabled for another reason never looks as if
 * it were loading. The assertions that held the old part were replaced here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { OrderListItem } from "@sufria/shared";
import { createOrdersApi } from "../../features/orders/api/orders-api.ts";
import { advance } from "../../features/orders/lib/board.ts";
import { createHttp } from "../../shared/api/http.ts";
import { memorySessionStore } from "../../shared/api/session-store.ts";

const COMPONENTS = fileURLToPath(
  new URL("../../features/orders/components/", import.meta.url),
);
const tsx = readFileSync(`${COMPONENTS}next-step-button.tsx`, "utf8");
/** The two next-step buttons' modules, and the selector of each. */
const MODULES = [
  ["order-card.module.css", ".action"],
  ["order-details.module.css", ".step"],
] as const;
/**
 * A module's «while it works» block, its button's selector as `.X` and the
 * state that marks it working as `.X:working` — which state that is, the
 * aria-busy test below holds.
 */
function busyBlock(file: string, selector: string): string {
  const css = readFileSync(`${COMPONENTS}${file}`, "utf8");
  const start = css.indexOf("/* ---- while it works: start");
  const end = css.indexOf("/* ---- while it works: end ---- */");
  assert.ok(start !== -1 && end > start, `${file}: no «while it works» block`);
  // The code alone: its comments name both buttons.
  return css
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(`${selector}[aria-busy="true"]`, ".X:working")
    .replaceAll(`${selector}:disabled`, ".X:working")
    .replaceAll(selector, ".X");
}

const ORDER: OrderListItem = {
  id: "11111111-1111-4111-8111-111111111111",
  orderNumber: 102,
  status: "pending_acceptance",
  fulfillmentType: "pickup",
  total: "13.50",
  itemCount: 1,
  createdAt: "2026-10-05T09:00:00.000Z",
  customer: { name: null, phone: "+962790004321" },
  items: [{ name: "شاورما", quantity: 1 }],
  statusChangedAt: "2026-10-05T09:00:00.000Z",
  cancellationReason: null,
};

test("🔴 nothing about the order changes before the server answers", async () => {
  let answer: (r: Response) => void = () => {};
  const api = createOrdersApi(
    createHttp({
      baseUrl: "http://api.test",
      store: memorySessionStore({
        accessToken: "a",
        refreshToken: "r",
        restaurantId: "rid",
        restaurantName: "مطعم",
      }),
      fetch: (() =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        })) as typeof fetch,
    }),
  );
  const shown = { ...ORDER };
  let outcome: Awaited<ReturnType<typeof advance>> | null = null;
  const pending = advance(api, shown, { to: "accepted", label: "اقبل" }).then(
    (o) => (outcome = o),
  );
  await new Promise((r) => setTimeout(r, 20));
  // The server has not answered: no outcome to show, the order as it was.
  assert.equal(outcome, null);
  assert.equal(shown.status, "pending_acceptance");
  answer(
    new Response(JSON.stringify({ ...ORDER, status: "accepted" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  await pending;
  assert.equal(outcome!.kind, "changed");
});

test("the press: disabled at once, the outcome only after the answer, the word unchanged", () => {
  const press = tsx.slice(tsx.indexOf("async function press()"));
  const busy = press.indexOf("setBusy(true)");
  const awaited = press.indexOf("await advance(");
  const outcome = press.indexOf("onOutcome(outcome)");
  assert.ok(busy !== -1 && busy < awaited && awaited < outcome);
  // Disabled while it works, and marked busy: the mark is what shows it
  // working (brief ي-ب §2), not the disabled state.
  assert.match(tsx, /disabled=\{busy\}/);
  assert.match(tsx, /aria-busy=\{busy\}/);
  assert.doesNotMatch(tsx, /data-busy|module\.css/);
  // Its only content is the action's word: no new text, busy or not.
  const open = tsx.indexOf("<button");
  const children = tsx.slice(
    tsx.indexOf(">", tsx.indexOf("disabled={busy}", open)) + 1,
    tsx.indexOf("</button>", open),
  );
  assert.equal(children.trim(), "{action.label}");
});

test("the look, on the card and on the details page alike: a shade darker, a thin line of the tokens running inside, still under reduced motion", () => {
  const [card, details] = MODULES.map(([file, selector]) =>
    busyBlock(file, selector),
  );
  // One look for both buttons: the two blocks are the same.
  assert.equal(card, details);
  const css = card!;
  const rule = (selector: string, from = 0) => {
    const at = css.indexOf(`${selector} {`, from);
    assert.notEqual(at, -1, `no ${selector}`);
    return css.slice(at, css.indexOf("}", at));
  };
  assert.match(rule("\n.X:working"), /filter: brightness\(0\.\d+\);/);
  const line = rule(".X:working::after");
  assert.match(line, /background: var\(--on-accent\);/);
  assert.match(line, /height: 2px;/);
  assert.match(line, /animation: var\(--step-working\);/);
  // The keyframes are global (globals.css): a module renames its keyframes,
  // and each name costs bytes in its JS that check:budget counts. The line
  // moves by transform alone — on the compositor, without laying the page
  // out every frame.
  const globals = readFileSync(
    fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
    "utf8",
  );
  assert.match(
    globals,
    /--step-working: step-working 1\.2s ease-in-out infinite;/,
  );
  const frames = globals.slice(
    globals.indexOf("@keyframes step-working {"),
    globals.indexOf("}\n}", globals.indexOf("@keyframes step-working {")),
  );
  assert.match(frames, /transform: translateX\(/);
  assert.doesNotMatch(frames, /inset|left|right|margin|width/);
  // Its way follows the text's: start to end, right to left in Arabic.
  assert.match(rule(".X:working:dir(rtl)::after"), /--way: -1;/);
  const still = css.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.notEqual(still, -1);
  assert.match(rule("  .X:working::after", still), /animation: none;/);
  // Inside the button, which holds it.
  for (const [file, selector] of MODULES) {
    const all = readFileSync(`${COMPONENTS}${file}`, "utf8");
    const at = all.indexOf(`\n${selector} {`);
    const own = all.slice(at, all.indexOf("}", at));
    assert.match(own, /position: relative;/, `${file} ${selector}`);
    assert.match(own, /overflow: hidden;/, `${file} ${selector}`);
  }
});

test("🔴 the working look is on aria-busy, never on :disabled — a button disabled for another reason does not look busy", () => {
  for (const [file, selector] of MODULES) {
    const css = readFileSync(`${COMPONENTS}${file}`, "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    assert.ok(
      !css.includes(`${selector}:disabled`),
      `${file}: ${selector}:disabled`,
    );
    for (const rule of [
      `\n${selector}[aria-busy="true"] {`,
      `\n${selector}[aria-busy="true"]::after {`,
      `\n${selector}[aria-busy="true"]:dir(rtl)::after {`,
      `\n  ${selector}[aria-busy="true"]::after {`,
    ])
      assert.ok(css.includes(rule), `${file}: no ${rule.trim()}`);
  }
  // Nowhere in the app does a :disabled rule darken a button or draw the
  // running line. (The login and cancel buttons keep `cursor: progress` on
  // :disabled: they are disabled only while they send, and cancel-dialog.tsx
  // does not change — brief ي-ب §0.)
  const WEB = fileURLToPath(new URL("../../", import.meta.url));
  const cssFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return cssFiles(path);
      return path.endsWith(".css") ? [path] : [];
    });
  const files = ["app", "features", "shared"].flatMap((d) =>
    cssFiles(join(WEB, d)),
  );
  assert.ok(files.length >= 5, "the walk found nothing — it is broken");
  for (const file of files) {
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const [, selector, body] = m as unknown as [string, string, string];
      if (!selector.includes(":disabled")) continue;
      assert.doesNotMatch(
        selector + body,
        /::after|filter:|animation:|opacity:/,
        `${file.slice(WEB.length)} ${selector.trim()}: a working look on :disabled`,
      );
    }
  }
});
