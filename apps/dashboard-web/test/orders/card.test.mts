/**
 * The card opens its order (brief I §4 I-3, §5 test 7). The press itself
 * needs a browser; what decides it does not, and is held here:
 *   - the link is on the order number and its ::after covers the card;
 *   - the next-step button is not inside the link, and sits above that layer;
 *   - the link goes to the order's id, with `?from=history` from «السجل».
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { OrderListItem } from "@sufria/shared";
import {
  backTo,
  cardView,
  orderHref,
} from "../../features/orders/lib/board.ts";

const COMPONENTS = fileURLToPath(
  new URL("../../features/orders/components/", import.meta.url),
);
const tsx = readFileSync(`${COMPONENTS}order-card.tsx`, "utf8");
const css = readFileSync(`${COMPONENTS}order-card.module.css`, "utf8");

/** The declarations of one CSS rule, by its exact selector. */
function rule(selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  assert.notEqual(at, -1, `no rule ${selector} in order-card.module.css`);
  return css.slice(at, css.indexOf("}", at));
}

const ORDER: OrderListItem = {
  id: "11111111-1111-4111-8111-111111111111",
  orderNumber: 102,
  status: "preparing",
  fulfillmentType: "delivery",
  total: "13.50",
  itemCount: 1,
  createdAt: "2026-10-05T09:00:00.000Z",
  customer: { name: null, phone: "+962790004321" },
  items: [{ name: "شاورما", quantity: 2 }],
  statusChangedAt: "2026-10-05T09:00:00.000Z",
  cancellationReason: null,
};

test("🔴 pressing the button does not open the order: it is outside the link, above its layer", () => {
  const links = [...tsx.matchAll(/<Link\b[\s\S]*?<\/Link>/g)].map((m) => m[0]);
  assert.equal(links.length, 1, "the card has one link");
  assert.match(links[0]!, /view\.number/, "the link is on the order number");
  assert.doesNotMatch(
    links[0]!,
    /<button\b|onClick/,
    "a button inside the link: pressing it opens the order too",
  );
  assert.match(tsx, /<button\b/, "the card still has its button");

  // The layer: the link's ::after covers the card, the button sits over it.
  assert.match(rule(".card"), /position:\s*relative/);
  const layer = rule(".open::after");
  assert.match(layer, /position:\s*absolute/);
  assert.match(layer, /inset:\s*0/);
  const button = rule(".action");
  assert.match(button, /position:\s*relative/);
  assert.match(button, /z-index:\s*[1-9]/);
});

test("pressing the card opens its order, with from=history from «السجل»", () => {
  assert.equal(
    cardView(ORDER, "active", "JOD", Date.now()).href,
    `/orders/${ORDER.id}`,
  );
  assert.equal(
    cardView({ ...ORDER, status: "completed" }, "history", "JOD", Date.now())
      .href,
    `/orders/${ORDER.id}?from=history`,
  );
  assert.equal(orderHref("a/b", "active"), "/orders/a%2Fb");
});

test("the details page goes back where it was opened from", () => {
  assert.deepEqual(backTo("history"), { href: "/history", label: "السجل" });
  assert.deepEqual(backTo(undefined), { href: "/orders", label: "الطلبات" });
  assert.deepEqual(backTo(["history", "x"]), {
    href: "/orders",
    label: "الطلبات",
  });
});
