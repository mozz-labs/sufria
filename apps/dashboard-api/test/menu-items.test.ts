/**
 * د-5 — `GET /menu-items` and `PATCH /menu-items/:id` (brief D §3.4, with
 * §8.1, §8.3, §8.6 and §8.7).
 *
 * Same harness as the D-2 to D-4 suites: the real AppModule over real HTTP,
 * into Postgres as `sufria_dashboard` with RLS live, and fixtures written — and
 * audited — through MIGRATION_DATABASE_URL.
 *
 * 🔴 The availability test reads `menu_items.is_available` straight from the
 *    database, never back through this API. The engine's «أكّد» check reads
 *    that column (`readCatalog`), and `order.test.ts` already proves an item
 *    turned off between the summary and «أكّد» makes no order. Together the
 *    two prove the dashboard and the engine talk about the same column. An API
 *    that stored the flag somewhere else would still read its own write back
 *    faithfully — which is why the round trip proves nothing here.
 *
 * The suite builds its own restaurant, whose menu is shaped so that every
 * tie-break of the customer's order decides something. The seed's items are
 * only ever the target of refused requests, and are put back regardless.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import type {
  MenuItemListItem,
  MenuItemListResponse,
  OrderDetail,
  UpdateMenuItemResponse,
} from "@sufria/shared";

import { AppModule } from "../src/app.module.js";

const RESTAURANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RESTAURANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SEED_ITEM_A = "e0000000-0000-4000-8000-00000000000a";
const SEED_ITEM_B = "e0000000-0000-4000-8000-00000000000b";
const STAFF_BOTH = "50000000-0000-4000-8000-000000000001";
/** Well-formed, and belongs to no menu item anywhere. */
const NO_SUCH_ITEM = "e0000000-0000-4000-8000-0000000000ff";

const RUN = `d5-${process.pid}-${Date.now()}`;
const LONG_AGO = "2026-01-01T08:00:00.000Z";

const NOT_FOUND_BODY = { message: "Not Found", statusCode: 404 };

let app: INestApplication;
let baseUrl: string;
let jwt: JwtService;
let audit: Pool;

const createdRestaurants: string[] = [];
const createdStaff: string[] = [];

let staffOnlyB = "";
let staffTest = "";
/** The restaurant whose menu the order test reads. Only an item GET never lists is patched there. */
let shop = "";
/** A second restaurant of this suite: `target` lives there. */
let benchShop = "";

/**
 * Explicit ids, so the last tie-break (`id`) is decided by the fixture and
 * not by gen_random_uuid(). Every row is inserted in an order that differs
 * from the expected one, so insertion order cannot pass for the ORDER BY.
 */
const id = (n: number): string =>
  `d5000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

const CAT = {
  offersFirst: id(0x10a),
  offersSecond: id(0x10b),
  grill: id(0x120),
  starters: id(0x130),
  sweets: id(0x140),
  off: id(0x150),
};

const ITEM = {
  familyMeal: id(0x201),
  singleMeal: id(0x202),
  shishTawook: id(0x203),
  fattoush: id(0x204),
  hummus: id(0x205),
  mutabbal: id(0x206),
  babaFirst: id(0x207),
  babaSecond: id(0x208),
  knafeh: id(0x209),
  mansaf: id(0x20a),
};

/** The item the PATCH tests change — in `benchShop`, out of the order test's menu. */
let target = "";

type ItemRow = {
  name: string;
  price: string;
  is_available: boolean;
  updated_at: string;
};

async function createStaff(label: string): Promise<string> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO staff_accounts (phone_or_email, password_hash, name)
     VALUES ($1, 'x', $2) RETURNING id`,
    [`${label}-${RUN}@sufria.test`, `موظف ${label}`],
  );
  const staffId = rows[0]!.id;
  createdStaff.push(staffId);
  return staffId;
}

async function addMember(staffId: string, restaurant: string): Promise<void> {
  await audit.query(
    `INSERT INTO restaurant_staff (staff_account_id, restaurant_id, role, is_active)
     VALUES ($1, $2, 'staff', true)`,
    [staffId, restaurant],
  );
}

async function createRestaurant(label: string): Promise<string> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status)
     VALUES ($1, $2, 'active') RETURNING id`,
    [`مطعم ${label} ${RUN}`, `PHONE_${label}_${RUN}`],
  );
  const restaurantId = rows[0]!.id;
  createdRestaurants.push(restaurantId);
  return restaurantId;
}

async function createCategory(spec: {
  restaurant: string;
  id?: string;
  name: string;
  displayOrder?: number;
  isActive?: boolean;
}): Promise<string> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO menu_categories (id, restaurant_id, name, display_order, is_active)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5)
     RETURNING id`,
    [
      spec.id ?? null,
      spec.restaurant,
      spec.name,
      spec.displayOrder ?? 0,
      spec.isActive ?? true,
    ],
  );
  return rows[0]!.id;
}

/** `updated_at` far in the past on purpose, so a PATCH that stamps it shows. */
async function createItem(spec: {
  restaurant: string;
  category: string;
  id?: string;
  name: string;
  price: string;
  displayOrder?: number;
  isAvailable?: boolean;
}): Promise<string> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO menu_items (id, restaurant_id, category_id, name, price,
                             display_order, is_available, created_at, updated_at)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5::numeric,
             $6, $7, $8::timestamptz, $8::timestamptz)
     RETURNING id`,
    [
      spec.id ?? null,
      spec.restaurant,
      spec.category,
      spec.name,
      spec.price,
      spec.displayOrder ?? 0,
      spec.isAvailable ?? true,
      LONG_AGO,
    ],
  );
  return rows[0]!.id;
}

/** The item as the database holds it — asked above RLS, never through the API. */
async function rowOf(itemId: string): Promise<ItemRow> {
  const { rows } = await audit.query<ItemRow>(
    `SELECT name, price::text AS price, is_available,
            updated_at::text AS updated_at
       FROM menu_items WHERE id = $1`,
    [itemId],
  );
  return rows[0]!;
}

const token = (staffAccountId: string): string =>
  jwt.sign({ sub: staffAccountId, typ: "access" });

function headers(opts: {
  staff?: string;
  restaurantId?: string;
}): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (opts.staff !== undefined)
    h["authorization"] = `Bearer ${token(opts.staff)}`;
  if (opts.restaurantId !== undefined) h["x-restaurant-id"] = opts.restaurantId;
  return h;
}

const getMenu = (opts: { staff?: string; restaurantId?: string }) =>
  fetch(`${baseUrl}/menu-items`, { headers: headers(opts) });

async function menuOk(
  staff: string,
  restaurantId: string,
): Promise<MenuItemListItem[]> {
  const res = await getMenu({ staff, restaurantId });
  expect(res.status).toBe(200);
  return ((await res.json()) as MenuItemListResponse).items;
}

function patchItem(
  itemId: string,
  body: unknown,
  opts: { staff?: string; restaurantId?: string },
): Promise<Response> {
  return fetch(`${baseUrl}/menu-items/${itemId}`, {
    method: "PATCH",
    headers: headers(opts),
    body: JSON.stringify(body),
  });
}

/** A PATCH by `staffTest`, in `benchShop` unless said otherwise. */
const patch = (itemId: string, body: unknown, restaurantId = benchShop) =>
  patchItem(itemId, body, { staff: staffTest, restaurantId });

async function patchOk(
  itemId: string,
  body: unknown,
  restaurantId = benchShop,
): Promise<UpdateMenuItemResponse> {
  const res = await patch(itemId, body, restaurantId);
  expect(res.status).toBe(200);
  return (await res.json()) as UpdateMenuItemResponse;
}

/** §8.7: nestjs-zod's existing 400, as the D-4 suite checks it. */
async function expectZod400(res: Response): Promise<void> {
  expect(res.status).toBe(400);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body["statusCode"]).toBe(400);
  expect(body["message"]).toBe("Validation failed");
  expect(Array.isArray(body["errors"])).toBe(true);
}

async function expectNotFound(res: Response): Promise<void> {
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual(NOT_FOUND_BODY);
}

/**
 * Runs `body` against seed items and puts every one of them back exactly as it
 * was, whatever `body` did: other suites, and the engine's, read the seed. The
 * tests using it expect nothing to change; the restore is for the day one of
 * them catches a leak.
 */
async function onSeedItems(
  itemIds: readonly string[],
  body: () => Promise<void>,
): Promise<void> {
  const seeded = new Map<string, ItemRow>();
  for (const itemId of itemIds) seeded.set(itemId, await rowOf(itemId));
  try {
    await body();
  } finally {
    for (const [itemId, row] of seeded)
      await audit.query(
        `UPDATE menu_items
            SET name = $2, price = $3::numeric, is_available = $4,
                updated_at = $5::timestamptz
          WHERE id = $1`,
        [itemId, row.name, row.price, row.is_available, row.updated_at],
      );
  }
  for (const [itemId, row] of seeded) expect(await rowOf(itemId)).toEqual(row);
}

beforeAll(async () => {
  const url = process.env["MIGRATION_DATABASE_URL"];
  if (!url)
    throw new Error(
      "MIGRATION_DATABASE_URL is missing — the suite needs it to ask above RLS. Copy .env.example to .env.",
    );
  audit = new Pool({ connectionString: url, max: 3 });

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0);
  baseUrl = (await app.getUrl()).replace("[::1]", "127.0.0.1");
  jwt = app.get(JwtService);

  staffOnlyB = await createStaff("only-b");
  await addMember(staffOnlyB, RESTAURANT_B);
  staffTest = await createStaff("d5");

  shop = await createRestaurant("d5");
  await addMember(staffTest, shop);

  // Categories, inserted out of order. Expected: the two «عروض» (order 0, same
  // name, so by id), then «مشاوي» and «مقبلات» (order 1, so by name), then
  // «حلويات» (order 2 — first by name, last by order). «أطباق موقوفة» is
  // inactive: first by order and by name, and absent.
  await createCategory({
    restaurant: shop,
    id: CAT.sweets,
    name: "حلويات",
    displayOrder: 2,
  });
  await createCategory({
    restaurant: shop,
    id: CAT.starters,
    name: "مقبلات",
    displayOrder: 1,
  });
  await createCategory({
    restaurant: shop,
    id: CAT.offersSecond,
    name: "عروض",
    displayOrder: 0,
  });
  await createCategory({
    restaurant: shop,
    id: CAT.off,
    name: "أطباق موقوفة",
    displayOrder: 0,
    isActive: false,
  });
  await createCategory({
    restaurant: shop,
    id: CAT.grill,
    name: "مشاوي",
    displayOrder: 1,
  });
  await createCategory({
    restaurant: shop,
    id: CAT.offersFirst,
    name: "عروض",
    displayOrder: 0,
  });

  // Items. Within «مقبلات»: «فتوش» (order 0), then «حمص» and «متبل» (order 1,
  // by name — «حمص» unavailable, and still in its place), then the two «بابا
  // غنوج» (order 2, same name, by id).
  await createItem({
    restaurant: shop,
    category: CAT.starters,
    id: ITEM.babaSecond,
    name: "بابا غنوج",
    price: "2.00",
    displayOrder: 2,
  });
  await createItem({
    restaurant: shop,
    category: CAT.starters,
    id: ITEM.mutabbal,
    name: "متبل",
    price: "1.75",
    displayOrder: 1,
  });
  await createItem({
    restaurant: shop,
    category: CAT.sweets,
    id: ITEM.knafeh,
    name: "كنافة",
    price: "3.00",
  });
  await createItem({
    restaurant: shop,
    category: CAT.off,
    id: ITEM.mansaf,
    name: "منسف",
    price: "7.50",
  });
  await createItem({
    restaurant: shop,
    category: CAT.starters,
    id: ITEM.hummus,
    name: "حمص",
    price: "1.50",
    displayOrder: 1,
    isAvailable: false,
  });
  await createItem({
    restaurant: shop,
    category: CAT.grill,
    id: ITEM.shishTawook,
    name: "شيش طاووق",
    price: "5.25",
  });
  await createItem({
    restaurant: shop,
    category: CAT.starters,
    id: ITEM.babaFirst,
    name: "بابا غنوج",
    price: "2.00",
    displayOrder: 2,
  });
  await createItem({
    restaurant: shop,
    category: CAT.offersSecond,
    id: ITEM.singleMeal,
    name: "وجبة فردية",
    price: "4.00",
  });
  await createItem({
    restaurant: shop,
    category: CAT.starters,
    id: ITEM.fattoush,
    name: "فتوش",
    price: "2.25",
  });
  await createItem({
    restaurant: shop,
    category: CAT.offersFirst,
    id: ITEM.familyMeal,
    name: "وجبة عائلية",
    price: "12.00",
  });

  // The PATCH tests' own item, in a restaurant of its own, so no PATCH below
  // can reorder or reprice the menu the order test reads.
  benchShop = await createRestaurant("d5-bench");
  await addMember(staffTest, benchShop);
  const benchCategory = await createCategory({
    restaurant: benchShop,
    name: "شاورما",
  });
  target = await createItem({
    restaurant: benchShop,
    category: benchCategory,
    name: "شاورما دجاج",
    price: "2.50",
  });
});

afterAll(async () => {
  await app?.close();
  if (audit) {
    if (createdRestaurants.length > 0)
      await audit.query(`DELETE FROM restaurants WHERE id = ANY($1::uuid[])`, [
        createdRestaurants,
      ]);
    if (createdStaff.length > 0)
      await audit.query(
        `DELETE FROM staff_accounts WHERE id = ANY($1::uuid[])`,
        [createdStaff],
      );
    await audit.end();
  }
});

// ---------------------------------------------------------------------------
// GET /menu-items — brief D §3.4 with §8.3.
// ---------------------------------------------------------------------------
describe("GET /menu-items", () => {
  it("🔴 lists the menu in the customer's order, unavailable items in their place, an inactive category's items absent, money as the database's text", async () => {
    const items = await menuOk(staffTest, shop);

    expect(items).toEqual([
      {
        id: ITEM.familyMeal,
        name: "وجبة عائلية",
        price: "12.00",
        isAvailable: true,
      },
      {
        id: ITEM.singleMeal,
        name: "وجبة فردية",
        price: "4.00",
        isAvailable: true,
      },
      {
        id: ITEM.shishTawook,
        name: "شيش طاووق",
        price: "5.25",
        isAvailable: true,
      },
      { id: ITEM.fattoush, name: "فتوش", price: "2.25", isAvailable: true },
      { id: ITEM.hummus, name: "حمص", price: "1.50", isAvailable: false },
      { id: ITEM.mutabbal, name: "متبل", price: "1.75", isAvailable: true },
      {
        id: ITEM.babaFirst,
        name: "بابا غنوج",
        price: "2.00",
        isAvailable: true,
      },
      {
        id: ITEM.babaSecond,
        name: "بابا غنوج",
        price: "2.00",
        isAvailable: true,
      },
      { id: ITEM.knafeh, name: "كنافة", price: "3.00", isAvailable: true },
    ]);
  });

  it("an item in an inactive category is absent even though the item itself is available (§8.3)", async () => {
    expect((await rowOf(ITEM.mansaf)).is_available).toBe(true);

    const ids = (await menuOk(staffTest, shop)).map((i) => i.id);

    expect(ids).not.toContain(ITEM.mansaf);
  });

  // 🔴 Isolation — brief §8.1, the three cases of D-2 on the menu.
  it("🔴 B-only staff under B's header sees B's items and not A's", async () => {
    const ids = (await menuOk(staffOnlyB, RESTAURANT_B)).map((i) => i.id);

    expect(ids).toContain(SEED_ITEM_B);
    expect(ids).not.toContain(SEED_ITEM_A);
  });

  it("B-only staff sending A's header is refused by the guard, with zero items", async () => {
    const res = await getMenu({
      staff: staffOnlyB,
      restaurantId: RESTAURANT_A,
    });

    expect(res.status).toBe(403);
    expect(
      ((await res.json()) as Record<string, unknown>)["items"],
    ).toBeUndefined();
  });

  it("🔴 dual-branch staff sees A's items alone under A's header, and B's alone under B's", async () => {
    const underA = (await menuOk(STAFF_BOTH, RESTAURANT_A)).map((i) => i.id);
    const underB = (await menuOk(STAFF_BOTH, RESTAURANT_B)).map((i) => i.id);

    expect(underA).toContain(SEED_ITEM_A);
    expect(underA).not.toContain(SEED_ITEM_B);
    expect(underB).toContain(SEED_ITEM_B);
    expect(underB).not.toContain(SEED_ITEM_A);
    // Nothing of any restaurant but the header's own, asked above RLS.
    const owners = await audit.query<{ restaurant_id: string }>(
      `SELECT DISTINCT restaurant_id FROM menu_items WHERE id = ANY($1::uuid[])`,
      [underA],
    );
    expect(owners.rows.map((r) => r.restaurant_id)).toEqual([RESTAURANT_A]);
  });

  it("rejects a request without a token with 401", async () => {
    const res = await getMenu({ restaurantId: RESTAURANT_A });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH /menu-items/:id — brief D §3.4 with §8.6.
// ---------------------------------------------------------------------------
describe("PATCH /menu-items/:id — availability", () => {
  it("🔴 isAvailable: false writes menu_items.is_available — the column the engine's «أكّد» check reads — read back from the database, not through the API", async () => {
    await patchOk(target, { isAvailable: true });
    expect((await rowOf(target)).is_available).toBe(true);

    const body = await patchOk(target, { isAvailable: false });

    expect(body).toEqual({
      id: target,
      name: "شاورما دجاج",
      price: (await rowOf(target)).price,
      isAvailable: false,
    });
    expect((await rowOf(target)).is_available).toBe(false);

    await patchOk(target, { isAvailable: true });
    expect((await rowOf(target)).is_available).toBe(true);
  });

  it("stamps updated_at, and the reply is the item after the change, as GET lists it", async () => {
    const before = await rowOf(target);

    const body = await patchOk(target, { isAvailable: false });

    const after = await rowOf(target);
    expect(after.updated_at > before.updated_at).toBe(true);
    expect(
      (await menuOk(staffTest, benchShop)).find((i) => i.id === target),
    ).toEqual(body);
    await patchOk(target, { isAvailable: true });
  });

  it("changing only the price leaves availability as it was, and the other way round", async () => {
    await audit.query(
      `UPDATE menu_items SET is_available = false, price = 2.50 WHERE id = $1`,
      [target],
    );

    await patchOk(target, { price: "2.75" });
    expect(await rowOf(target)).toMatchObject({
      price: "2.75",
      is_available: false,
    });

    await patchOk(target, { isAvailable: true });
    expect(await rowOf(target)).toMatchObject({
      price: "2.75",
      is_available: true,
    });
  });
});

describe("PATCH /menu-items/:id — price", () => {
  it.each([
    ["3", "3.00"],
    ["3.5", "3.50"],
    ["3.05", "3.05"],
    ["0.50", "0.50"],
    ["999999.99", "999999.99"],
  ])(
    "price %s is stored as numeric and comes back as the database's text %s",
    async (sent, stored) => {
      const body = await patchOk(target, { price: sent });

      expect(body.price).toBe(stored);
      expect((await rowOf(target)).price).toBe(stored);
    },
  );

  it("both fields at once", async () => {
    // A known starting point: a leftover `false` from an earlier test would
    // let this pass without the PATCH writing anything.
    await audit.query(
      `UPDATE menu_items SET is_available = true, price = 2.50 WHERE id = $1`,
      [target],
    );

    const body = await patchOk(target, { isAvailable: false, price: "4.25" });

    expect(body).toMatchObject({ price: "4.25", isAvailable: false });
    expect(await rowOf(target)).toMatchObject({
      price: "4.25",
      is_available: false,
    });
    await patchOk(target, { isAvailable: true });
  });

  it("🔴 a new price leaves an existing order at its old one, through GET /orders/:id («السعر وعد»)", async () => {
    await patchOk(target, { price: "2.50" });
    const customer = await audit.query<{ id: string }>(
      `INSERT INTO customers (restaurant_id, phone_number) VALUES ($1, '+962790000005')
       RETURNING id`,
      [benchShop],
    );
    const order = await audit.query<{ id: string }>(
      `INSERT INTO orders (restaurant_id, customer_id, order_number, fulfillment_type,
                           payment_method, status, payment_status, subtotal, total)
       VALUES ($1, $2, 101, 'pickup', 'cash', 'pending_acceptance', 'pending_cash',
               5.00, 5.00)
       RETURNING id`,
      [benchShop, customer.rows[0]!.id],
    );
    const orderId = order.rows[0]!.id;
    await audit.query(
      `INSERT INTO order_items (order_id, restaurant_id, menu_item_id,
                                item_name_snapshot, unit_price_snapshot, quantity)
       VALUES ($1, $2, $3, 'شاورما دجاج', 2.50, 2)`,
      [orderId, benchShop, target],
    );

    await patchOk(target, { price: "3.00" });
    expect((await rowOf(target)).price).toBe("3.00");

    const res = await fetch(`${baseUrl}/orders/${orderId}`, {
      headers: headers({ staff: staffTest, restaurantId: benchShop }),
    });
    expect(res.status).toBe(200);
    const detail = (await res.json()) as OrderDetail;
    expect(detail.items).toEqual([
      {
        name: "شاورما دجاج",
        quantity: 2,
        unitPrice: "2.50",
        lineTotal: "5.00",
      },
    ]);
    expect(detail.total).toBe("5.00");
  });
});

// ---------------------------------------------------------------------------
// 🔴 Arabic-Indic digits — brief D §0, a test by name. A price in them is a
//    400, not a price converted behind the staff's back.
// ---------------------------------------------------------------------------
describe("PATCH /menu-items/:id — Arabic-Indic digits", () => {
  it.each([
    ["٢.٥٠", "Arabic-Indic digits"],
    ["٣", "a single Arabic-Indic digit"],
    ["2.٥٠", "Western and Arabic-Indic mixed"],
    ["۲.۵۰", "Persian (Extended Arabic-Indic) digits"],
    ["2٫50", "the Arabic decimal separator"],
  ])(
    "🔴 rejects price %s (%s) with 400, and the price is untouched",
    async (price) => {
      const before = await rowOf(target);

      await expectZod400(await patch(target, { price }));

      expect(await rowOf(target)).toEqual(before);
    },
  );
});

// ---------------------------------------------------------------------------
// Input — 400 in nestjs-zod's existing shape (§8.7), and nothing written.
// ---------------------------------------------------------------------------
describe("PATCH /menu-items/:id — input", () => {
  it.each([
    ["price 0", { price: "0" }],
    ["price 0.00", { price: "0.00" }],
    ["price 00.0", { price: "00.0" }],
    ["a negative price", { price: "-1.00" }],
    ["three decimals", { price: "2.505" }],
    ["a price that is a number, not text", { price: 2.5 }],
    ["an empty price", { price: "" }],
    ["a price with spaces around it", { price: " 2.50" }],
    ["exponent notation", { price: "1e3" }],
    ["seven integer digits", { price: "1234567" }],
    ["a leading plus", { price: "+3" }],
    ["no integer part", { price: ".5" }],
    ["a trailing point", { price: "3." }],
    ["a null price", { price: null }],
    ["isAvailable as text", { isAvailable: "false" }],
    ["isAvailable as a number", { isAvailable: 0 }],
    ["a null isAvailable", { isAvailable: null }],
    ["an empty body", {}],
    ["a key the contract does not have (name)", { name: "اسم جديد" }],
    [
      "a key the contract does not have (restaurantId), next to a valid field",
      { isAvailable: false, restaurantId: RESTAURANT_B },
    ],
  ])("rejects %s with 400, and the item is untouched", async (_label, body) => {
    const before = await rowOf(target);

    await expectZod400(await patch(target, body));

    expect(await rowOf(target)).toEqual(before);
  });

  it("rejects an id that is not a UUID with 400", async () => {
    await expectZod400(await patch("not-a-uuid", { isAvailable: false }));
  });

  it("a well-formed id that belongs to no item is 404", async () => {
    await expectNotFound(await patch(NO_SUCH_ITEM, { isAvailable: false }));
  });

  it("rejects a request without a token with 401", async () => {
    const res = await patchItem(
      target,
      { isAvailable: false },
      {
        restaurantId: benchShop,
      },
    );
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 🔴 Isolation — brief §2.9 and §8.1. Another restaurant's item is 404, with
//    the very body a non-existent id gets, and it does not change.
// ---------------------------------------------------------------------------
describe("PATCH /menu-items/:id — isolation", () => {
  const turnOff = { isAvailable: false, price: "9.99" };

  it("🔴 an item of restaurant A patched by the staff of restaurant B is 404, and A's item is untouched", async () => {
    await onSeedItems([SEED_ITEM_A], async () => {
      const before = await rowOf(SEED_ITEM_A);

      await expectNotFound(
        await patchItem(SEED_ITEM_A, turnOff, {
          staff: staffOnlyB,
          restaurantId: RESTAURANT_B,
        }),
      );

      expect(await rowOf(SEED_ITEM_A)).toEqual(before);
    });
  });

  it("dual-branch staff under B's header cannot change A's item either: 404", async () => {
    await onSeedItems([SEED_ITEM_A], async () => {
      const before = await rowOf(SEED_ITEM_A);

      await expectNotFound(
        await patchItem(SEED_ITEM_A, turnOff, {
          staff: STAFF_BOTH,
          restaurantId: RESTAURANT_B,
        }),
      );

      expect(await rowOf(SEED_ITEM_A)).toEqual(before);
    });
  });

  it("B-only staff sending A's header is refused by the guard, and A's item is untouched", async () => {
    await onSeedItems([SEED_ITEM_A], async () => {
      const before = await rowOf(SEED_ITEM_A);

      const res = await patchItem(SEED_ITEM_A, turnOff, {
        staff: staffOnlyB,
        restaurantId: RESTAURANT_A,
      });

      expect(res.status).toBe(403);
      expect(await rowOf(SEED_ITEM_A)).toEqual(before);
    });
  });

  it("another restaurant's item gets the very 404 an id that exists nowhere gets", async () => {
    await onSeedItems([SEED_ITEM_A], async () => {
      const other = await patchItem(SEED_ITEM_A, turnOff, {
        staff: staffOnlyB,
        restaurantId: RESTAURANT_B,
      });
      const none = await patchItem(NO_SUCH_ITEM, turnOff, {
        staff: staffOnlyB,
        restaurantId: RESTAURANT_B,
      });

      expect(other.status).toBe(none.status);
      expect(await other.json()).toEqual(await none.json());
    });
  });
});

// ---------------------------------------------------------------------------
// §8.3: "PATCH لا يتغيّر" — hidden from the list is not hidden from its own id.
// ---------------------------------------------------------------------------
describe("PATCH /menu-items/:id — an inactive category", () => {
  it("an item of an inactive category can still be patched by its own restaurant: the category hides it from GET, not from PATCH", async () => {
    const body = await patchOk(ITEM.mansaf, { price: "8.00" }, shop);

    expect(body).toMatchObject({ id: ITEM.mansaf, price: "8.00" });
    expect((await rowOf(ITEM.mansaf)).price).toBe("8.00");
    expect((await menuOk(staffTest, shop)).map((i) => i.id)).not.toContain(
      ITEM.mansaf,
    );
  });
});
