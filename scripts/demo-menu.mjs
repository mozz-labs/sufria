/**
 * Demo script: the menu from the dashboard, through the API, the way the menu
 * screen will (brief ي-أ §6) — until the screen exists (brief ي-ب).
 *
 * 🔴 A development tool — never for a real restaurant. Like
 *    `demo-order-status.mjs`, whose pattern it follows.
 *
 *   node --env-file=.env scripts/demo-menu.mjs list
 *   node --env-file=.env scripts/demo-menu.mjs pause
 *   node --env-file=.env scripts/demo-menu.mjs resume
 *   node --env-file=.env scripts/demo-menu.mjs price <number> <price>   (takes ٣٫٧٥)
 *   node --env-file=.env scripts/demo-menu.mjs on <number>
 *   node --env-file=.env scripts/demo-menu.mjs off <number>
 *   node --env-file=.env scripts/demo-menu.mjs archive <number>
 *   node --env-file=.env scripts/demo-menu.mjs archived
 *   node --env-file=.env scripts/demo-menu.mjs restore <number>
 *
 * 🔴 <number> is the item's place in `list` — 1, 2, 3… in the order of
 *    GET /menu-items — not the number on the customer's menu (that one skips
 *    switched-off items). For `restore`, its place in `archived`.
 *
 * Through the API, not the database: the price is normalised, the 4096 guard
 * runs and the archive constraint holds exactly as they will for the screen.
 *
 * Reads DEMO_STAFF_EMAIL and DEMO_STAFF_PASSWORD from `.env` and never prints
 * them, nor the token. One line per result:
 *   OK <what changed>
 *   FAIL <status> <code or reason>   — a 409 prints its `code`.
 */

const USAGE =
  "node --env-file=.env scripts/demo-menu.mjs <list|pause|resume|price <n> <price>|on <n>|off <n>|archive <n>|archived|restore <n>>";
const NEEDS_NUMBER = ["price", "on", "off", "archive", "restore"];
const COMMANDS = ["list", "pause", "resume", "archived", ...NEEDS_NUMBER];

function fail(code, reason) {
  console.log(`FAIL ${code} ${reason}`);
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  fail("refused", "demo script is not for production");
}

const [command, numberArg, priceArg, ...extra] = process.argv.slice(2);
if (
  !COMMANDS.includes(command) ||
  extra.length > 0 ||
  (command === "price") !== (priceArg !== undefined) ||
  NEEDS_NUMBER.includes(command) !== (numberArg !== undefined)
) {
  fail("usage", USAGE);
}

const email = process.env.DEMO_STAFF_EMAIL;
const password = process.env.DEMO_STAFF_PASSWORD;
if (!email || !password) {
  fail(
    "config",
    "DEMO_STAFF_EMAIL and DEMO_STAFF_PASSWORD must be set in .env",
  );
}

const base = `http://localhost:${process.env.DASHBOARD_API_PORT || 3002}`;

/** A JSON request. Returns the body on 2xx; prints a FAIL line otherwise. */
async function call(method, path, { token, restaurantId, body } = {}) {
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(restaurantId ? { "x-restaurant-id": restaurantId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    fail(
      "network",
      `${base} unreachable — is dashboard-api running? (${error.cause?.code ?? error.message})`,
    );
  }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A 409 carries `code` (brief ي-أ §5), and menu_too_long its lengths.
    if (payload.code === "menu_too_long") {
      fail(res.status, `menu_too_long ${payload.length}/${payload.limit}`);
    }
    const detail = payload.code ?? payload.message ?? res.statusText;
    fail(res.status, Array.isArray(detail) ? detail.join("; ") : detail);
  }
  return payload;
}

const login = await call("POST", "/auth/login", {
  body: { phoneOrEmail: email, password },
});
// The numbers are one restaurant's list: an account in two would be ambiguous.
if (login.restaurants.length !== 1) {
  fail(
    "config",
    `the demo account must belong to exactly one restaurant (it belongs to ${login.restaurants.length})`,
  );
}
const auth = {
  token: login.accessToken,
  restaurantId: login.restaurants[0].id,
};

const state = (item) => (item.isAvailable ? "متاح" : "مطفي");
const describe = (n, item) =>
  `${n}. ${item.name} — ${item.price} — ${state(item)} — ${item.categoryName}`;

async function listed(archived) {
  const { items } = await call(
    "GET",
    archived ? "/menu-items?archived=true" : "/menu-items",
    auth,
  );
  return items;
}

/** The item at <number> in a list, or a FAIL line naming the range. */
function at(items, arg, listName) {
  const n = Number(arg);
  if (!Number.isInteger(n) || n < 1 || n > items.length) {
    fail(
      "usage",
      items.length === 0
        ? `${listName} is empty`
        : `<number> is 1 to ${items.length} — see ${listName}`,
    );
  }
  return items[n - 1];
}

const patch = (item, body) =>
  call("PATCH", `/menu-items/${item.id}`, { ...auth, body });

switch (command) {
  case "list":
  case "archived": {
    const items = await listed(command === "archived");
    if (items.length === 0) console.log(`OK ${command}: empty`);
    for (const [i, item] of items.entries()) {
      console.log(
        command === "archived"
          ? `${describe(i + 1, item)} — archived ${item.archivedAt}`
          : describe(i + 1, item),
      );
    }
    break;
  }
  case "pause":
  case "resume": {
    const { ordersPausedAt } = await call("PATCH", "/restaurant/orders-pause", {
      ...auth,
      body: { paused: command === "pause" },
    });
    console.log(
      ordersPausedAt === null
        ? "OK taking orders"
        : `OK orders paused since ${ordersPausedAt}`,
    );
    break;
  }
  case "price": {
    const item = at(await listed(false), numberArg, "list");
    // Sent as typed: the API turns ٣٫٧٥ into 3.75 (decision 6).
    const changed = await patch(item, { price: priceArg });
    console.log(
      `OK ${numberArg}. ${changed.name}: ${item.price} → ${changed.price}`,
    );
    break;
  }
  case "on":
  case "off": {
    const item = at(await listed(false), numberArg, "list");
    const changed = await patch(item, { isAvailable: command === "on" });
    console.log(`OK ${numberArg}. ${changed.name} ${state(changed)}`);
    break;
  }
  case "archive": {
    const item = at(await listed(false), numberArg, "list");
    const changed = await patch(item, { archived: true });
    console.log(`OK ${changed.name} archived at ${changed.archivedAt}`);
    break;
  }
  case "restore": {
    const item = at(await listed(true), numberArg, "archived");
    const changed = await patch(item, { archived: false });
    // Back in the list, switched off (decision 4): its new number, for `on`.
    const place = (await listed(false)).findIndex((i) => i.id === changed.id);
    console.log(
      `OK ${changed.name} restored, ${state(changed)} — number ${place + 1} in list`,
    );
    break;
  }
}
