/**
 * سكربت عرض: يغيّر حالة طلب عبر الـAPI، كما يفعل زر اللوحة (بريف و §5).
 *
 * 🔴 أداة تطوير — **لا تُستعمل مع مطعم حقيقي.** الشاشة لم تُبنَ بعد، وهذا
 *    السكربت بديلها المؤقت لتجربة إشعارات الزبون (FR-11) على جهاز المطوّر.
 *
 *   node --env-file=.env scripts/demo-order-status.mjs <رقم الطلب> <الحالة> [السبب]
 *   node --env-file=.env scripts/demo-order-status.mjs 101 accepted
 *   node --env-file=.env scripts/demo-order-status.mjs 101 cancelled "نفد الخبز"
 *
 * عبر الـAPI، لا القاعدة مباشرة: حتى يمرّ بالـCAS وسطر التاريخ و
 * `notified = false` تماما كما سيفعل الزر، فالمُراقِب يرى ما سيراه في الحقيقة.
 *
 * يقرأ `DEMO_STAFF_EMAIL` و`DEMO_STAFF_PASSWORD` من `.env` ولا يطبعهما أبدا،
 * ولا يطبع التذكرة. المخرج سطر واحد:
 *   OK 101 accepted → preparing
 *   FAIL <الكود> <السبب>
 */

const TARGETS = ["accepted", "preparing", "ready", "completed", "cancelled"];

function fail(code, reason) {
  console.log(`FAIL ${code} ${reason}`);
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  fail("refused", "demo script is not for production");
}

const [numberArg, to, reason] = process.argv.slice(2);
const orderNumber = Number(numberArg);
if (
  !Number.isInteger(orderNumber) ||
  orderNumber <= 0 ||
  !TARGETS.includes(to)
) {
  fail(
    "usage",
    `node --env-file=.env scripts/demo-order-status.mjs <order number> <${TARGETS.join("|")}> [reason]`,
  );
}
if (reason !== undefined && to !== "cancelled") {
  fail("usage", "a reason is only accepted with cancelled");
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

/** طلب JSON. يعيد الجسم عند 2xx، ويخرج بسطر FAIL عند غيره. */
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
    // 409 يحمل `code` (د §8.7)؛ غيره رسالة Nest.
    const detail = payload.code ?? payload.message ?? res.statusText;
    fail(res.status, Array.isArray(detail) ? detail.join("; ") : detail);
  }
  return payload;
}

const login = await call("POST", "/auth/login", {
  body: { phoneOrEmail: email, password },
});
// حساب في أكثر من فرع: أرقام الطلبات لكل مطعم، فالرقم وحده ملتبس.
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

const { orders } = await call("GET", "/orders?tab=active", auth);
const order = orders.find((o) => o.orderNumber === orderNumber);
if (!order) fail("not_found", `no active order ${orderNumber}`);

const changed = await call("PATCH", `/orders/${order.id}/status`, {
  ...auth,
  body: {
    from: order.status,
    to,
    ...(reason !== undefined ? { cancellationReason: reason } : {}),
  },
});
console.log(`OK ${orderNumber} ${order.status} → ${changed.status}`);
