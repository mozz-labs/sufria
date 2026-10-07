/**
 * The order details page (brief I §4 I-6, §5 test 6): what it sends — `from`
 * as shown, a reason only when there is one — what a 409 leads to, what a
 * finished order still offers, and the customer's number kept out of sight.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ORDER_STATUSES,
  STAFF_TRANSITIONS,
  nextStaffAction,
  type OrderDetail,
  type OrderMessage,
  type UpdateOrderStatusRequest,
} from "@sufria/shared";
import { createOrdersApi } from "../../features/orders/api/orders-api.ts";
import { advance, cancelOrder } from "../../features/orders/lib/board.ts";
import {
  conversationView,
  detailView,
  reasonCounter,
} from "../../features/orders/lib/details.ts";
import { createHttp } from "../../shared/api/http.ts";
import { memorySessionStore } from "../../shared/api/session-store.ts";

const NOW = Date.parse("2026-10-05T12:00:00.000Z");
const PHONE = "962791234567";

const ORDER: OrderDetail = {
  id: "22222222-2222-4222-8222-222222222222",
  orderNumber: 102,
  status: "ready",
  fulfillmentType: "delivery",
  subtotal: "12.00",
  deliveryFee: "1.50",
  total: "13.50",
  paymentMethod: "cash",
  paymentStatus: "pending_cash",
  deliveryAddress: "شارع الجامعة، بناية 12",
  cancellationReason: null,
  createdAt: "2026-10-05T11:54:00.000Z",
  customer: { name: null, phone: PHONE },
  items: [
    { name: "شاورما", quantity: 2, unitPrice: "5.00", lineTotal: "10.00" },
    { name: "بطاطا", quantity: 1, unitPrice: "2.00", lineTotal: "2.00" },
  ],
  history: [
    {
      from: null,
      to: "pending_acceptance",
      actor: "customer",
      at: "2026-10-05T11:54:00.000Z",
    },
    {
      from: "pending_acceptance",
      to: "ready",
      actor: "staff",
      at: "2026-10-05T11:58:00.000Z",
    },
  ],
};

/**
 * An API whose PATCH answers `status` with `body`, recording what was sent —
 * and whose GET of the order says it is `preparing` by now: a fresher read
 * than the page's, which `from` must never be taken from.
 */
function apiReplying(status: number, body: unknown) {
  const sent: UpdateOrderStatusRequest[] = [];
  const api = createOrdersApi(
    createHttp({
      baseUrl: "http://api.test",
      store: memorySessionStore({
        accessToken: "a",
        refreshToken: "r",
        restaurantId: "rid",
        restaurantName: "مطعم",
      }),
      fetch: (async (_url: string, init: RequestInit = {}) => {
        if (init.method === "GET")
          return new Response(
            JSON.stringify({ ...ORDER, status: "preparing" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        sent.push(JSON.parse(init.body as string));
        return new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch,
    }),
  );
  return { api, sent };
}

const conflict = (code: string, extra: object = {}) => ({
  statusCode: 409,
  error: "Conflict",
  code,
  message: "…",
  ...extra,
});

test("🔴 from is the status the page showed — the next step and the cancel both", async () => {
  // `ready`: not the first status, so a hard-coded `from` cannot pass.
  const step = apiReplying(200, {});
  await advance(step.api, ORDER, { to: "completed", label: "وصل للزبون" });
  assert.deepEqual(step.sent, [{ from: "ready", to: "completed" }]);

  const cancel = apiReplying(200, {});
  await cancelOrder(cancel.api, ORDER, "نفد الخبز");
  assert.deepEqual(cancel.sent, [
    { from: "ready", to: "cancelled", cancellationReason: "نفد الخبز" },
  ]);
});

test("🔴 a reason empty after trimming is not sent at all; a reason is sent trimmed", async () => {
  for (const blank of ["", "   ", "\n\t "]) {
    const { api, sent } = apiReplying(200, {});
    await cancelOrder(api, ORDER, blank);
    assert.deepEqual(
      sent,
      [{ from: "ready", to: "cancelled" }],
      JSON.stringify(blank),
    );
  }
  const { api, sent } = apiReplying(200, {});
  await cancelOrder(api, ORDER, "  نفد الخبز \n");
  assert.equal(sent[0]!.cancellationReason, "نفد الخبز");
});

test("409: status_conflict refreshes with its line; any other 409 is the other line", async () => {
  const moved = apiReplying(
    409,
    conflict("status_conflict", { currentStatus: "completed" }),
  );
  assert.deepEqual(await cancelOrder(moved.api, ORDER, ""), {
    kind: "refresh",
    line: "تغيّرت حالة الطلب من جهاز آخر.",
  });
  const refused = apiReplying(409, conflict("payment_not_settled"));
  assert.deepEqual(
    await advance(refused.api, ORDER, { to: "completed", label: "وصل للزبون" }),
    { kind: "failed", line: "لا يمكن تنفيذ هذه الخطوة الآن." },
  );
});

test("🔴 a finished order has no next step and no cancel — «راسل الزبون» stays", () => {
  for (const status of ORDER_STATUSES) {
    const view = detailView({ ...ORDER, status }, "JOD", NOW);
    const done = STAFF_TRANSITIONS[status].length === 0;
    assert.equal(view.action === null, done, status);
    assert.equal(view.canCancel, !done, status);
    assert.deepEqual(view.action, nextStaffAction(status, "delivery"));
    assert.equal(view.chat, `https://wa.me/${PHONE}`);
  }
  assert.deepEqual(
    ORDER_STATUSES.filter(
      (s) => detailView({ ...ORDER, status: s }, "JOD", NOW).canCancel,
    ),
    ["pending_acceptance", "accepted", "preparing", "ready"],
  );
});

test("🔴 «راسل الزبون»: wa.me with the full number, which nothing else on the page shows", () => {
  const view = detailView(
    { ...ORDER, customer: { name: null, phone: `+${PHONE}` } },
    "JOD",
    NOW,
  );
  assert.equal(view.chat, `https://wa.me/${PHONE}`);
  assert.equal(view.customer, "•••• 4567");
  // A number, in the numbers' font (I-9 #2); a name stays text.
  assert.equal(view.customerMasked, true);
  const named = detailView(
    { ...ORDER, customer: { name: "أبو خالد", phone: PHONE } },
    "JOD",
    NOW,
  );
  assert.equal(named.customerMasked, false);
  // Everything the page shows as text: the view without its link.
  const shown = JSON.stringify({ ...view, chat: null });
  assert.doesNotMatch(shown, new RegExp(PHONE.slice(0, 8)));
});

test("the order, in its words: lines, the fee for a delivery alone, the total, payment, address, reason, history", () => {
  const view = detailView(ORDER, "JOD", NOW);
  assert.equal(view.number, "#102");
  assert.equal(view.kind, "توصيل");
  assert.equal(view.since, "منذ 6 دقائق");
  assert.deepEqual(view.lines, [
    { label: "شاورما ×2", amount: "10.00 د.أ" },
    { label: "بطاطا", amount: "2.00 د.أ" },
  ]);
  assert.equal(view.deliveryFee, "1.50 د.أ");
  assert.equal(view.total, "13.50 د.أ");
  assert.equal(view.payment, null);
  assert.equal(view.address, "شارع الجامعة، بناية 12");
  assert.ok(view.history.every((h) => h.reason === null));
  assert.deepEqual(
    view.history.map((h) => h.badge),
    ["معلّق", "جاهز"],
  );
  // Its HH:MM — after its date when that is not today on this device's clock
  // (I-9 #6, held below): 11:54Z is yesterday at UTC−12.
  assert.match(view.history[0]!.time, /\d\d:\d\d$/);

  const pickup = detailView(
    {
      ...ORDER,
      fulfillmentType: "pickup",
      deliveryFee: "0.00",
      deliveryAddress: null,
      status: "completed",
      paymentStatus: "collected",
    },
    "ILS",
    NOW,
  );
  assert.equal(pickup.deliveryFee, null);
  assert.equal(pickup.address, null);
  assert.equal(pickup.payment, "محصَّل");
  assert.equal(pickup.total, "13.50 شيكل");
});

test("dates after a day (I-9 #6): the header's age, and a status from before today", () => {
  const two = (n: number) => String(n).padStart(2, "0");
  const written = (ms: number) => {
    const d = new Date(ms);
    return `${d.getDate()}/${d.getMonth() + 1} · ${two(d.getHours())}:${two(d.getMinutes())}`;
  };
  const created = NOW - 30 * 3_600_000;
  const accepted = NOW - 29 * 3_600_000;
  const view = detailView(
    {
      ...ORDER,
      createdAt: new Date(created).toISOString(),
      history: [
        { ...ORDER.history[0]!, at: new Date(created).toISOString() },
        { ...ORDER.history[1]!, at: new Date(accepted).toISOString() },
        {
          from: "ready",
          to: "completed",
          actor: "staff",
          // This very moment: today, in any time zone.
          at: new Date(NOW).toISOString(),
        },
      ],
    },
    "JOD",
    NOW,
  );
  assert.equal(view.since, written(created));
  const today = new Date(NOW);
  assert.deepEqual(
    view.history.map((h) => h.time),
    [
      written(created),
      written(accepted),
      `${two(today.getHours())}:${two(today.getMinutes())}`,
    ],
  );
});

test("the reason right under «ملغى» in the history (I-9 #4): the cancellation's entry alone", () => {
  const history: OrderDetail["history"] = [
    ...ORDER.history,
    {
      from: "ready",
      to: "cancelled",
      actor: "staff",
      at: "2026-10-05T11:59:00.000Z",
    },
  ];
  const cancelled = (cancellationReason: string | null) =>
    detailView(
      { ...ORDER, status: "cancelled", cancellationReason, history },
      "JOD",
      NOW,
    );
  assert.deepEqual(
    cancelled("نفد الخبز").history.map((h) => [h.badge, h.reason]),
    [
      ["معلّق", null],
      ["جاهز", null],
      ["ملغى", "نفد الخبز"],
    ],
  );
  // Without a reason: nothing at all — no label over an empty line.
  assert.deepEqual(
    cancelled(null).history.map((h) => h.reason),
    [null, null, null],
  );
  // Under «ملغى» and nowhere else: no longer under «العنوان».
  assert.equal("reason" in cancelled("نفد الخبز"), false);

  const tsx = readFileSync(
    fileURLToPath(
      new URL(
        "../../features/orders/components/order-details.tsx",
        import.meta.url,
      ),
    ),
    "utf8",
  );
  const item = tsx.slice(
    tsx.indexOf("view.history.map("),
    tsx.indexOf("</li>", tsx.indexOf("view.history.map(")),
  );
  assert.match(item, /h\.reason !== null/);
  assert.match(
    item,
    /className=\{styles\.label\}>\s*\{T\.details\.cancellationReason\}/,
  );
  assert.match(item, /dir="auto">\s*\{h\.reason\}/);
});

const message = (
  direction: OrderMessage["direction"],
  text: string,
  at = "2026-10-05T11:50:00.000Z",
): OrderMessage => ({
  id: `${direction}-${text.length}-${at}`,
  direction,
  text,
  at,
});

test("the conversation: the customer at the start, the bot at the end; a long bot message opens on two lines", () => {
  const menu = [
    "القائمة",
    "1. شاورما",
    "2. بطاطا",
    "3. حمص",
    "4. فلافل",
    "5. كنافة",
    "6. شاي",
  ].join("\n");
  const long = ["سطر", "سطر", "سطر", "سطر", "سطر", "سطر", "سطر"].join("\n");
  const view = conversationView([
    message("inbound", "مرحبا"),
    message("outbound", menu),
    message("inbound", long),
    message("outbound", "سطر واحد"),
  ]);
  assert.equal(view.notice, null);
  assert.deepEqual(
    view.messages.map((m) => [m.from, m.preview]),
    [
      ["customer", null],
      ["bot", "القائمة\n1. شاورما"],
      // The customer's own long message is shown whole: it is theirs.
      ["customer", null],
      ["bot", null],
    ],
  );
});

/** «2 و5» in Arabic-Indic digits — escaped: check:numerals reads this file too. */
const EASTERN = "\u0662 \u0648\u0665";

test("the conversation's notices: nothing kept, or the customer's messages alone", () => {
  assert.equal(conversationView([]).notice, "لا رسائل محفوظة لهذا الطلب.");
  assert.equal(
    conversationView([message("inbound", EASTERN)]).notice,
    "تظهر هنا رسائل الزبون فقط.",
  );
  // Shown as it came — Arabic-Indic digits are what the customer wrote.
  assert.equal(
    conversationView([message("inbound", EASTERN)]).messages[0]!.text,
    EASTERN,
  );
  assert.match(EASTERN, /[\u0660-\u0669]/u);
});

test("the cancel dialog's counter: «12 / 300», one group read left to right (I-9 #3)", () => {
  assert.equal(reasonCounter(0), "0 / 300");
  assert.equal(reasonCounter(12), "12 / 300");
  // Isolated (.num) and left to right: inside the page's right to left, the
  // group alone read «300 / 12».
  const tsx = readFileSync(
    fileURLToPath(
      new URL(
        "../../features/orders/components/cancel-dialog.tsx",
        import.meta.url,
      ),
    ),
    "utf8",
  );
  const at = tsx.indexOf('id="cancel-count"');
  assert.notEqual(at, -1, "no counter in cancel-dialog.tsx");
  const tag = tsx.slice(at, tsx.indexOf(">", at));
  assert.match(tag, /dir="ltr"/);
  assert.match(tag, /className=\{`num /);
  assert.match(tsx.slice(at), /^[^<]*>\s*\{reasonCounter\(reason\.length\)\}/);
});

test("the history's times in one column, whatever the badge's width (I-9 #5)", () => {
  const css = readFileSync(
    fileURLToPath(
      new URL(
        "../../features/orders/components/order-details.module.css",
        import.meta.url,
      ),
    ),
    "utf8",
  );
  const rule = (selector: string) => {
    const at = css.indexOf(`\n${selector} {`);
    assert.notEqual(at, -1, `no rule ${selector}`);
    return css.slice(at, css.indexOf("}", at));
  };
  // The list holds the two columns: the badges, as wide as the widest…
  assert.match(rule(".history"), /display: grid;/);
  assert.match(
    rule(".history"),
    /grid-template-columns: max-content minmax\(0, 1fr\);/,
  );
  // …and every row takes them as they are, so its time starts there too.
  assert.match(rule(".historyItem"), /grid-column: 1 \/ -1;/);
  assert.match(rule(".historyItem"), /grid-template-columns: subgrid;/);
  // A badge keeps its own width inside the column.
  assert.match(rule(".historyBadge"), /justify-self: start;/);
});

test("a date reads «28/9 · 14:30», never «14:30 · 28/9» (I-9 #6): its direction on every span", () => {
  const read = (file: string) =>
    readFileSync(
      fileURLToPath(
        new URL(`../../features/orders/components/${file}`, import.meta.url),
      ),
      "utf8",
    );
  /** The opening tag that holds `{expr}`. */
  const tagOf = (src: string, expr: string) => {
    const at = src.indexOf(`{${expr}}`);
    assert.notEqual(at, -1, `no {${expr}}`);
    return src.slice(src.lastIndexOf("<", at), at);
  };
  // «منذ…» is Arabic, a date is numbers: auto picks right to left for the
  // one, left to right for the other (measured in Chrome 145).
  assert.match(tagOf(read("order-card.tsx"), "view.since"), /dir="auto"/);
  const details = read("order-details.tsx");
  assert.match(tagOf(details, "view.since"), /dir="auto"/);
  // The history's time is numbers alone.
  assert.match(tagOf(details, "h.time"), /dir="ltr"/);
  // …and still starts where its column starts, not at the text's left.
  const css = read("order-details.module.css");
  const at = css.indexOf("\n.time {");
  assert.match(css.slice(at, css.indexOf("}", at)), /justify-self: start;/);
});
