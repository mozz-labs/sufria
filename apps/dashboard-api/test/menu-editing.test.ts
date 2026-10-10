/**
 * ja-4 · the menu from the dashboard — brief ي-أ §5, tests 1–14: adding an
 * item, its name and its price, archiving and bringing back, «شغّل الكل»,
 * pausing orders, and the 4096 guard.
 *
 * The harness of `menu-items.test.ts`: the real AppModule over real HTTP, into
 * Postgres as `sufria_dashboard` with RLS live; fixtures written — and every
 * effect read back — through MIGRATION_DATABASE_URL, above RLS, never through
 * the API that wrote it. Every restaurant is this file's own, and every read
 * is narrowed to one of them (CLAUDE.md: the engine suite runs alongside).
 *
 * The guard's lengths are computed here with the very functions the engine
 * and the API build the first message with (`renderMenuText`,
 * `firstMenuMessageAr`, `whatsappTextLength`). What is tested is which message
 * the API measures and what it does at the limit; the text itself is pinned
 * by the engine's `menu-snapshot.test.ts`.
 *
 * 🔴 Test 5's cases all cross 4096 with the menu alone, without the welcome:
 *    the welcome's share is test 6's alone, so a guard that forgot it fails
 *    there and only there.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import {
  MENU_ITEM_NAME_MAX,
  WHATSAPP_TEXT_LIMIT,
  firstMenuMessageAr,
  priceToMinor,
  renderMenuText,
  welcomeMessageAr,
  whatsappTextLength,
  type ArchivedMenuItemListResponse,
  type CreateMenuItemResponse,
  type EnableAllMenuItemsResponse,
  type MenuCategoryListResponse,
  type MenuConflictBody,
  type MenuItemListItem,
  type MenuItemListResponse,
  type OrdersPauseResponse,
  type RestaurantSettings,
  type UpdateMenuItemResponse,
} from "@sufria/shared";

import { AppModule } from "../src/app.module.js";

const RUN = `ja4-${process.pid}-${Date.now()}`;
const NOT_FOUND_BODY = { message: "Not Found", statusCode: 404 };
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let app: INestApplication;
let baseUrl: string;
let jwt: JwtService;
let audit: Pool;

const createdRestaurants: string[] = [];
const createdStaff: string[] = [];

/** Member of every restaurant this file creates, but `otherShop`. */
let staff = "";
/** Member of `otherShop` alone. */
let otherStaff = "";
let shop = "";
let otherShop = "";
const CAT = { starters: "", grill: "", off: "", other: "" };

type ItemRow = {
  id: string;
  name: string;
  price: string;
  is_available: boolean;
  archived_at: string | null;
  display_order: number;
};

// ---------------------------------------------------------------------------
// Fixtures — through the audit connection
// ---------------------------------------------------------------------------

async function createStaff(label: string): Promise<string> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO staff_accounts (phone_or_email, password_hash, name)
     VALUES ($1, 'x', $2) RETURNING id`,
    [`${label}-${RUN}@sufria.test`, `موظف ${label}`],
  );
  createdStaff.push(rows[0]!.id);
  return rows[0]!.id;
}

async function addMember(staffId: string, restaurant: string): Promise<void> {
  await audit.query(
    `INSERT INTO restaurant_staff (staff_account_id, restaurant_id, role, is_active)
     VALUES ($1, $2, 'staff', true)`,
    [staffId, restaurant],
  );
}

/** A restaurant of this file's, with `staff` a member of it. */
async function createRestaurant(name: string): Promise<string> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status)
     VALUES ($1, $2, 'active') RETURNING id`,
    [name, `PHONE_JA4_${createdRestaurants.length}_${RUN}`],
  );
  const id = rows[0]!.id;
  createdRestaurants.push(id);
  await addMember(staff, id);
  return id;
}

async function createCategory(
  restaurant: string,
  name: string,
  opts: { displayOrder?: number; isActive?: boolean } = {},
): Promise<string> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO menu_categories (restaurant_id, name, display_order, is_active)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [restaurant, name, opts.displayOrder ?? 0, opts.isActive ?? true],
  );
  return rows[0]!.id;
}

async function createItem(
  restaurant: string,
  category: string,
  item: {
    name: string;
    price: string;
    displayOrder?: number;
    isAvailable?: boolean;
    archived?: boolean;
  },
): Promise<string> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO menu_items (restaurant_id, category_id, name, price,
                             display_order, is_available, archived_at)
     VALUES ($1, $2, $3, $4::numeric, $5, $6,
             CASE WHEN $7 THEN now() - interval '1 hour' END)
     RETURNING id`,
    [
      restaurant,
      category,
      item.name,
      item.price,
      item.displayOrder ?? 0,
      item.isAvailable ?? !item.archived,
      item.archived ?? false,
    ],
  );
  return rows[0]!.id;
}

const ROW_COLUMNS = `id, name, price::text AS price, is_available,
                     archived_at::text AS archived_at, display_order`;

async function rowOf(itemId: string): Promise<ItemRow> {
  const { rows } = await audit.query<ItemRow>(
    `SELECT ${ROW_COLUMNS} FROM menu_items WHERE id = $1`,
    [itemId],
  );
  return rows[0]!;
}

/** Every item of one restaurant, as the database holds them. */
async function itemsOf(restaurant: string): Promise<ItemRow[]> {
  const { rows } = await audit.query<ItemRow>(
    `SELECT ${ROW_COLUMNS} FROM menu_items WHERE restaurant_id = $1 ORDER BY id`,
    [restaurant],
  );
  return rows;
}

/** Items with this exact name, in any restaurant — the names are this run's own. */
async function itemsNamed(name: string): Promise<ItemRow[]> {
  const { rows } = await audit.query<ItemRow>(
    `SELECT ${ROW_COLUMNS} FROM menu_items WHERE name = $1`,
    [name],
  );
  return rows;
}

async function pausedAt(restaurant: string): Promise<string | null> {
  const { rows } = await audit.query<{ at: string | null }>(
    `SELECT orders_paused_at::text AS at FROM restaurants WHERE id = $1`,
    [restaurant],
  );
  return rows[0]!.at;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

type As = { staff?: string; restaurantId?: string };

function call(
  method: string,
  path: string,
  as: As,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (as.staff !== undefined)
    headers["authorization"] =
      `Bearer ${jwt.sign({ sub: as.staff, typ: "access" })}`;
  if (as.restaurantId !== undefined)
    headers["x-restaurant-id"] = as.restaurantId;
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const as = (restaurantId: string): As => ({ staff, restaurantId });

async function ok<T>(res: Promise<Response>, status = 200): Promise<T> {
  const r = await res;
  const body = (await r.json()) as T;
  expect({ status: r.status, body }).toMatchObject({ status });
  return body;
}

const menuOf = (restaurant: string) =>
  ok<MenuItemListResponse>(call("GET", "/menu-items", as(restaurant))).then(
    (r) => r.items,
  );

const archivedOf = (restaurant: string) =>
  ok<ArchivedMenuItemListResponse>(
    call("GET", "/menu-items?archived=true", as(restaurant)),
  ).then((r) => r.items);

const addItem = (restaurant: string, body: unknown, who: As = as(restaurant)) =>
  call("POST", "/menu-items", who, body);

const patchItem = (
  restaurant: string,
  itemId: string,
  body: unknown,
  who: As = as(restaurant),
) => call("PATCH", `/menu-items/${itemId}`, who, body);

const enableAll = (restaurant: string, who: As = as(restaurant)) =>
  call("POST", "/menu-items/enable-all", who);

const setPause = (
  restaurant: string,
  body: unknown,
  who: As = as(restaurant),
) => call("PATCH", "/restaurant/orders-pause", who, body);

/** nestjs-zod's existing 400 (brief D §8.7). */
async function expectZod400(res: Promise<Response>): Promise<void> {
  const r = await res;
  expect(r.status).toBe(400);
  const body = (await r.json()) as Record<string, unknown>;
  expect(body["message"]).toBe("Validation failed");
  expect(Array.isArray(body["errors"])).toBe(true);
}

async function expectNotFound(res: Promise<Response>): Promise<void> {
  const r = await res;
  expect(r.status).toBe(404);
  expect(await r.json()).toEqual(NOT_FOUND_BODY);
}

async function expectConflict(
  res: Promise<Response>,
  expected: Partial<MenuConflictBody>,
): Promise<MenuConflictBody> {
  const r = await res;
  const body = (await r.json()) as MenuConflictBody;
  expect(r.status).toBe(409);
  expect(body).toMatchObject({
    statusCode: 409,
    error: "Conflict",
    ...expected,
  });
  expect(typeof body.message).toBe("string");
  return body;
}

/**
 * A 409 `menu_too_long`: the body to the key, `limit` 4096 and a `length` over
 * it. Which length exactly — the welcome's share in it — is test 6's to hold,
 * so that a guard that forgot the welcome fails there and only there.
 */
async function expectTooLong(res: Promise<Response>): Promise<void> {
  const body = await expectConflict(res, { code: "menu_too_long" });
  expect(body).toEqual({
    statusCode: 409,
    error: "Conflict",
    code: "menu_too_long",
    message: expect.any(String),
    length: expect.any(Number),
    limit: WHATSAPP_TEXT_LIMIT,
  });
  expect((body as { length: number }).length).toBeGreaterThan(
    WHATSAPP_TEXT_LIMIT,
  );
}

// ---------------------------------------------------------------------------
// The first message, measured here as the engine builds it
// ---------------------------------------------------------------------------

type ModelItem = { name: string; price: string; available: boolean };

const GUARD_CATEGORY = "أطباق";

function rowsOf(items: readonly ModelItem[]) {
  return items
    .filter((i) => i.available)
    .map((it, i) => ({
      number: i + 1,
      name: it.name,
      priceMinor: priceToMinor(it.price),
      categoryId: "c",
      categoryName: GUARD_CATEGORY,
    }));
}

const menuAloneLength = (items: readonly ModelItem[]) =>
  whatsappTextLength(renderMenuText(rowsOf(items), "JOD"));

const firstLength = (restaurantName: string) => (items: readonly ModelItem[]) =>
  whatsappTextLength(
    firstMenuMessageAr(restaurantName, renderMenuText(rowsOf(items), "JOD")),
  );

const filler = (letters: number): ModelItem => ({
  name: "ب".repeat(letters),
  price: "1.00",
  available: true,
});

/**
 * Filler items such that `measure(fillers ++ tail)` is exactly `target`:
 * 300-letter fillers, then one whose name makes up the rest. `tail` is what
 * comes after them in the menu — an item to rename, or switched-off ones.
 */
function fillTo(
  target: number,
  measure: (items: readonly ModelItem[]) => number,
  tail: readonly ModelItem[] = [],
): ModelItem[] {
  const items: ModelItem[] = [];
  while (measure([...items, filler(300), filler(1), ...tail]) <= target)
    items.push(filler(300));
  const rest = target - measure([...items, filler(0), ...tail]);
  if (rest < 1 || rest > 300) throw new Error(`cannot fill to ${target}`);
  items.push(filler(rest));
  expect(measure([...items, ...tail])).toBe(target);
  return items;
}

interface GuardShop {
  id: string;
  name: string;
  first: (items: readonly ModelItem[]) => number;
  /** The welcome and its newline: what the first message adds to the menu. */
  welcome: number;
  category: string;
  /** Item ids, in the order of `items`. */
  ids: string[];
}

let guardCount = 0;

/** A restaurant of its own, its one category holding `items` in that order. */
async function guardShop(items: readonly ModelItem[]): Promise<GuardShop> {
  const name = `مطعم حد ${++guardCount}`;
  const id = await createRestaurant(name);
  const category = await createCategory(id, GUARD_CATEGORY);
  const ids: string[] = [];
  for (const [i, it] of items.entries())
    ids.push(
      await createItem(id, category, {
        name: it.name,
        price: it.price,
        displayOrder: i,
        isAvailable: it.available,
      }),
    );
  return {
    id,
    name,
    first: firstLength(name),
    welcome: whatsappTextLength(welcomeMessageAr(name)) + 1,
    category,
    ids,
  };
}

/** The restaurant names `guardShop` will give — known before it is created. */
const nextGuardName = () => `مطعم حد ${guardCount + 1}`;

// ---------------------------------------------------------------------------

beforeAll(async () => {
  const url = process.env["MIGRATION_DATABASE_URL"];
  if (!url)
    throw new Error(
      "MIGRATION_DATABASE_URL is missing — the suite needs it to ask above RLS.",
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

  staff = await createStaff("ja4");
  otherStaff = await createStaff("ja4-other");

  shop = await createRestaurant(`مطعم ي-أ ${RUN}`);
  CAT.starters = await createCategory(shop, "مقبلات", { displayOrder: 0 });
  CAT.grill = await createCategory(shop, "مشاوي", { displayOrder: 1 });
  CAT.off = await createCategory(shop, "أطباق موقوفة", {
    displayOrder: 0,
    isActive: false,
  });

  // `otherShop`: not `staff`'s — created without the helper, so `staff` is no
  // member of it.
  const other = await audit.query<{ id: string }>(
    `INSERT INTO restaurants (name, whatsapp_phone_id, status)
     VALUES ($1, $2, 'active') RETURNING id`,
    [`مطعم آخر ${RUN}`, `PHONE_JA4_OTHER_${RUN}`],
  );
  otherShop = other.rows[0]!.id;
  createdRestaurants.push(otherShop);
  await addMember(otherStaff, otherShop);
  CAT.other = await createCategory(otherShop, "مقبلات");
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
// 1–4 · POST /menu-items, the name, the price
// ---------------------------------------------------------------------------

describe("1–4 · adding an item, its name and its price", () => {
  it("1. POST adds an item: 201, last in its category, available, with its category", async () => {
    const first = await createItem(shop, CAT.starters, {
      name: "حمص",
      price: "2.00",
      displayOrder: 4,
    });
    await createItem(shop, CAT.grill, { name: "شيش طاووق", price: "5.25" });

    const created = await ok<CreateMenuItemResponse>(
      addItem(shop, { categoryId: CAT.starters, name: "فتوش", price: "3.00" }),
      201,
    );

    expect(created).toEqual({
      id: expect.any(String),
      name: "فتوش",
      price: "3.00",
      isAvailable: true,
      categoryId: CAT.starters,
      categoryName: "مقبلات",
    });
    const row = await rowOf(created.id);
    expect(row).toMatchObject({ is_available: true, archived_at: null });
    expect(row.display_order).toBe(5);

    // Last of «مقبلات», right before «مشاوي» begins — and listed as it was returned.
    const items = await menuOf(shop);
    const at = items.findIndex((i) => i.id === created.id);
    expect(items[at - 1]?.id).toBe(first);
    expect(items[at + 1]?.categoryName).toBe("مشاوي");
    expect(items[at]).toEqual(created);
  });

  it("2. 🔴 another restaurant's category, or an inactive one: 404, and no row anywhere", async () => {
    const name = `صنف غريب ${RUN}`;

    await expectNotFound(
      addItem(shop, { categoryId: CAT.other, name, price: "1.00" }),
    );
    await expectNotFound(
      addItem(shop, { categoryId: CAT.off, name, price: "1.00" }),
    );
    // A well-formed id that is no category at all — the same 404.
    await expectNotFound(
      addItem(shop, {
        categoryId: "d5000000-0000-4000-8000-0000000000ff",
        name,
        price: "1.00",
      }),
    );

    expect(await itemsNamed(name)).toEqual([]);
  });

  it("POST input: every field required and well-formed, nothing else — 400, nothing written", async () => {
    const name = `صنف ناقص ${RUN}`;
    for (const body of [
      { name, price: "1.00" },
      { categoryId: CAT.starters, price: "1.00" },
      { categoryId: CAT.starters, name },
      { categoryId: "not-a-uuid", name, price: "1.00" },
      { categoryId: CAT.starters, name, price: 1 },
      { categoryId: CAT.starters, name, price: "1.00", isAvailable: false },
    ])
      await expectZod400(addItem(shop, body));

    expect(await itemsNamed(name)).toEqual([]);
  });

  it(`3. the name: ${MENU_ITEM_NAME_MAX} characters pass, ${MENU_ITEM_NAME_MAX + 1} do not; blank or with a newline is a 400; runs of spaces become one`, async () => {
    const forty = "ف".repeat(MENU_ITEM_NAME_MAX);
    const created = await ok<CreateMenuItemResponse>(
      addItem(shop, { categoryId: CAT.grill, name: forty, price: "4.00" }),
      201,
    );
    expect((await rowOf(created.id)).name).toBe(forty);

    for (const name of [
      "ق".repeat(MENU_ITEM_NAME_MAX + 1),
      "    ",
      "شاورما\nدجاج",
    ])
      await expectZod400(
        addItem(shop, { categoryId: CAT.grill, name, price: "4.00" }),
      );
    expect(await itemsNamed("ق".repeat(MENU_ITEM_NAME_MAX + 1))).toEqual([]);

    const spaced = await ok<CreateMenuItemResponse>(
      addItem(shop, {
        categoryId: CAT.grill,
        name: "  كباب   حلبي ",
        price: "4.00",
      }),
      201,
    );
    expect(spaced.name).toBe("كباب حلبي");
    expect((await rowOf(spaced.id)).name).toBe("كباب حلبي");

    // PATCH takes the same name, through the same normalisation.
    const renamed = await ok<UpdateMenuItemResponse>(
      patchItem(shop, spaced.id, { name: " كباب  هندي" }),
    );
    expect(renamed.name).toBe("كباب هندي");
    await expectZod400(patchItem(shop, spaced.id, { name: "كباب\tهندي" }));
    expect((await rowOf(spaced.id)).name).toBe("كباب هندي");
  });

  it("4. 🔴 a price in Arabic-Indic digits: «٢٫٥٠» is stored «2.50» and comes back «2.50»; 0 and 2,50 are a 400", async () => {
    const created = await ok<CreateMenuItemResponse>(
      addItem(shop, {
        categoryId: CAT.grill,
        name: `كفتة ${RUN}`,
        price: "٢٫٥٠",
      }),
      201,
    );
    expect(created.price).toBe("2.50");
    expect((await rowOf(created.id)).price).toBe("2.50");

    // Decision 6 turns brief D §0's «a 400» around: every one of these was
    // refused before; each is converted now.
    for (const [sent, stored] of [
      ["٣٫٧٥", "3.75"],
      ["٣", "3.00"],
      ["2.٥٠", "2.50"],
      ["۲.۵۰", "2.50"],
      ["2٫50", "2.50"],
      ["۲.۵", "2.50"],
      [" 4.25 ", "4.25"],
    ] as const) {
      const body = await ok<UpdateMenuItemResponse>(
        patchItem(shop, created.id, { price: sent }),
      );
      expect(body.price).toBe(stored);
      expect((await rowOf(created.id)).price).toBe(stored);
    }

    const before = await rowOf(created.id);
    for (const price of ["0", "٠", "2,50", "٢،٥٠", "٢٬٥٠"])
      await expectZod400(patchItem(shop, created.id, { price }));
    expect(await rowOf(created.id)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// 5–7 · 🔴 the 4096 guard
// ---------------------------------------------------------------------------

describe("5–7 · 🔴 the 4096 guard", () => {
  it("5a. an item added that takes the first message over 4096: 409 menu_too_long with length and limit, and nothing written", async () => {
    const name = nextGuardName();
    const fill = fillTo(WHATSAPP_TEXT_LIMIT, firstLength(name));
    const s = await guardShop(fill);
    const added: ModelItem = {
      name: "ت".repeat(30),
      price: "2.50",
      available: true,
    };
    // The precondition that keeps test 6 the welcome's alone.
    expect(menuAloneLength([...fill, added])).toBeGreaterThan(
      WHATSAPP_TEXT_LIMIT,
    );
    const before = await itemsOf(s.id);

    await expectTooLong(
      addItem(s.id, {
        categoryId: s.category,
        name: added.name,
        price: "2.50",
      }),
    );

    expect(await itemsOf(s.id)).toEqual(before);
  });

  it("5b. a name made longer: 409 menu_too_long, and the name as it was", async () => {
    const name = nextGuardName();
    const renamed: ModelItem = { name: "حمص", price: "2.00", available: true };
    const fill = fillTo(WHATSAPP_TEXT_LIMIT, firstLength(name), [renamed]);
    const s = await guardShop([...fill, renamed]);
    const longer = "حمص بالطحينة واللحمة والصنوبر المحمص";
    expect(
      menuAloneLength([...fill, { ...renamed, name: longer }]),
    ).toBeGreaterThan(WHATSAPP_TEXT_LIMIT);
    const before = await itemsOf(s.id);

    await expectTooLong(patchItem(s.id, s.ids.at(-1)!, { name: longer }));

    expect(await itemsOf(s.id)).toEqual(before);
  });

  it("5c. a price made longer on a menu already at the edge: 409 menu_too_long, and the price as it was", async () => {
    // A price grows by five characters at most («1.00» → «999999.99»), less
    // than the welcome: to cross 4096 with the menu alone it starts four short
    // of the limit without the welcome — over it with the welcome.
    const repriced: ModelItem = { name: "حمص", price: "1.00", available: true };
    const fill = fillTo(WHATSAPP_TEXT_LIMIT - 3, menuAloneLength, [repriced]);
    const s = await guardShop([...fill, repriced]);
    const dearer = { ...repriced, price: "999999.99" };
    expect(menuAloneLength([...fill, dearer])).toBeGreaterThan(
      WHATSAPP_TEXT_LIMIT,
    );
    const before = await itemsOf(s.id);

    await expectTooLong(patchItem(s.id, s.ids.at(-1)!, { price: "999999.99" }));

    expect(await itemsOf(s.id)).toEqual(before);
  });

  it("5d. an item switched on: 409 menu_too_long, and it stays off", async () => {
    const name = nextGuardName();
    const off: ModelItem = {
      name: "ث".repeat(40),
      price: "1.00",
      available: false,
    };
    const fill = fillTo(WHATSAPP_TEXT_LIMIT, firstLength(name), [off]);
    const s = await guardShop([...fill, off]);
    expect(
      menuAloneLength([...fill, { ...off, available: true }]),
    ).toBeGreaterThan(WHATSAPP_TEXT_LIMIT);
    const before = await itemsOf(s.id);

    await expectTooLong(patchItem(s.id, s.ids.at(-1)!, { isAvailable: true }));

    expect(await itemsOf(s.id)).toEqual(before);
  });

  it("5e. «شغّل الكل»: 409 menu_too_long, and every item stays off", async () => {
    const name = nextGuardName();
    const off: ModelItem[] = [
      { name: "ج".repeat(40), price: "1.00", available: false },
      { name: "خ".repeat(40), price: "1.00", available: false },
    ];
    const fill = fillTo(WHATSAPP_TEXT_LIMIT, firstLength(name), off);
    const s = await guardShop([...fill, ...off]);
    const on = off.map((o) => ({ ...o, available: true }));
    expect(menuAloneLength([...fill, ...on])).toBeGreaterThan(
      WHATSAPP_TEXT_LIMIT,
    );
    const before = await itemsOf(s.id);

    await expectTooLong(enableAll(s.id));

    expect(await itemsOf(s.id)).toEqual(before);
  });

  it("6. 🔴 the edge is the first message — the welcome counts: 4096 passes, 4097 does not, and a menu of 4096 alone does not either", async () => {
    // Its line is longer than the welcome, so the third menu below fits
    // before the add and stops fitting with it.
    const added: ModelItem = {
      name: "زعتر بالزيت والسماق",
      price: "1.50",
      available: true,
    };
    const add = (s: GuardShop) =>
      addItem(s.id, {
        categoryId: s.category,
        name: added.name,
        price: "1.50",
      });

    // The first message after the add: exactly 4096 — sent, so allowed.
    const exact = nextGuardName();
    const s1 = await guardShop(
      fillTo(WHATSAPP_TEXT_LIMIT, firstLength(exact), [added]),
    );
    await ok(add(s1), 201);

    // 4097 — one past it.
    const over = nextGuardName();
    const s2 = await guardShop(
      fillTo(WHATSAPP_TEXT_LIMIT + 1, firstLength(over), [added]),
    );
    await expectConflict(add(s2), {
      code: "menu_too_long",
      length: WHATSAPP_TEXT_LIMIT + 1,
    });

    // The menu alone is exactly 4096 after the add: it would fit — and the
    // welcome takes the first message over it.
    const fill3 = fillTo(WHATSAPP_TEXT_LIMIT, menuAloneLength, [added]);
    const s3 = await guardShop(fill3);
    expect(s3.first(fill3)).toBeLessThanOrEqual(WHATSAPP_TEXT_LIMIT);
    const before = await itemsOf(s3.id);

    await expectConflict(add(s3), {
      code: "menu_too_long",
      length: WHATSAPP_TEXT_LIMIT + s3.welcome,
    });
    expect(await itemsOf(s3.id)).toEqual(before);
  });

  it("7. a menu over 4096 already (from the setup script, say) takes a change that shortens it, or keeps it as long — 200", async () => {
    const name = nextGuardName();
    const long: ModelItem = {
      name: "ش".repeat(200),
      price: "1.00",
      available: true,
    };
    const fill = fillTo(5000, firstLength(name), [long]);
    const s = await guardShop([...fill, long]);
    const item = s.ids.at(-1)!;

    const shorter = await ok<UpdateMenuItemResponse>(
      patchItem(s.id, item, { name: "شاورما" }),
    );
    expect(shorter.name).toBe("شاورما");
    expect(s.first([...fill, { ...long, name: "شاورما" }])).toBeGreaterThan(
      WHATSAPP_TEXT_LIMIT,
    );

    // As long as before: «2.00» for «1.00».
    await ok(patchItem(s.id, item, { price: "2.00" }));
    expect((await rowOf(item)).price).toBe("2.00");

    // And longer than before is still refused.
    await expectConflict(patchItem(s.id, item, { price: "12.00" }), {
      code: "menu_too_long",
    });
    expect((await rowOf(item)).price).toBe("2.00");
  });
});

// ---------------------------------------------------------------------------
// 8–11 · archiving, bringing back, «شغّل الكل»
// ---------------------------------------------------------------------------

describe("8–11 · archiving, bringing back, «شغّل الكل»", () => {
  it("8. 🔴 archived: gone from GET, listed by ?archived=true, is_available false in the database — and archiving again keeps the first moment", async () => {
    const item = await createItem(shop, CAT.grill, {
      name: `مشاوي مشكلة ${RUN}`,
      price: "9.00",
    });

    const archived = await ok<UpdateMenuItemResponse>(
      patchItem(shop, item, { archived: true }),
    );

    expect(archived).toMatchObject({ id: item, isAvailable: false });
    expect(archived.archivedAt).toMatch(ISO);
    expect((await menuOf(shop)).map((i) => i.id)).not.toContain(item);
    const listed = (await archivedOf(shop)).find((i) => i.id === item);
    expect(listed).toEqual({
      id: item,
      name: `مشاوي مشكلة ${RUN}`,
      price: "9.00",
      isAvailable: false,
      categoryId: CAT.grill,
      categoryName: "مشاوي",
      archivedAt: archived.archivedAt,
    });
    const row = await rowOf(item);
    expect(row.is_available).toBe(false);
    expect(row.archived_at).not.toBeNull();

    const again = await ok<UpdateMenuItemResponse>(
      patchItem(shop, item, { archived: true }),
    );
    expect(again.archivedAt).toBe(archived.archivedAt);
    expect((await rowOf(item)).archived_at).toBe(row.archived_at);
  });

  it("?archived=true: the most recently archived first, and nothing that is not archived", async () => {
    const older = await createItem(shop, CAT.starters, {
      name: `أرشيف قديم ${RUN}`,
      price: "1.00",
      archived: true,
    });
    const newer = await createItem(shop, CAT.starters, {
      name: `أرشيف جديد ${RUN}`,
      price: "1.00",
    });
    await ok(patchItem(shop, newer, { archived: true }));

    const ids = (await archivedOf(shop)).map((i) => i.id);

    expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older));
    const live = (await menuOf(shop)).map((i) => i.id);
    expect(ids.filter((id) => live.includes(id))).toEqual([]);
  });

  it("9. an archived item takes nothing but archived: false — isAvailable: true, a price, a name: 409 item_archived, not a 500", async () => {
    const item = await createItem(shop, CAT.grill, {
      name: `صنف مؤرشف ${RUN}`,
      price: "3.00",
      archived: true,
    });
    const before = await rowOf(item);

    for (const body of [
      { isAvailable: true },
      { price: "4.00" },
      { name: "اسم جديد" },
      { isAvailable: false, price: "4.00" },
    ]) {
      const conflict = await expectConflict(patchItem(shop, item, body), {
        code: "item_archived",
      });
      expect(conflict).not.toHaveProperty("length");
    }

    expect(await rowOf(item)).toEqual(before);
  });

  it("archived with any other field is a 400; so is an empty body", async () => {
    const item = await createItem(shop, CAT.grill, {
      name: `صنف ${RUN}`,
      price: "3.00",
    });
    const before = await rowOf(item);

    for (const body of [
      { archived: true, isAvailable: false },
      { archived: false, price: "4.00" },
      { archived: true, name: "اسم" },
      { archived: "true" },
      {},
    ])
      await expectZod400(patchItem(shop, item, body));

    expect(await rowOf(item)).toEqual(before);
  });

  it("10. 🔴 brought back (archived: false): in GET again, in its place — and switched off", async () => {
    const neighbour = await createItem(shop, CAT.starters, {
      name: `متبل ${RUN}`,
      price: "1.75",
      displayOrder: 1,
    });
    const item = await createItem(shop, CAT.starters, {
      name: `بابا غنوج ${RUN}`,
      price: "2.00",
      displayOrder: 2,
      archived: true,
    });

    const back = await ok<UpdateMenuItemResponse>(
      patchItem(shop, item, { archived: false }),
    );

    expect(back).toMatchObject({
      id: item,
      isAvailable: false,
      archivedAt: null,
    });
    const items = await menuOf(shop);
    const at = items.findIndex((i) => i.id === item);
    expect(items[at]?.isAvailable).toBe(false);
    expect(items.findIndex((i) => i.id === neighbour)).toBeLessThan(at);
    expect(await rowOf(item)).toMatchObject({
      is_available: false,
      archived_at: null,
    });
  });

  it("11. «شغّل الكل»: the switched-off item on, the archived one untouched — enabled: 1", async () => {
    const s = await createRestaurant(`مطعم شغّل الكل ${RUN}`);
    const cat = await createCategory(s, "مقبلات");
    const off = await createCategory(s, "موقوف", { isActive: false });
    const on = await createItem(s, cat, { name: "حمص", price: "2.00" });
    const switchedOff = await createItem(s, cat, {
      name: "متبل",
      price: "2.00",
      isAvailable: false,
    });
    const archived = await createItem(s, cat, {
      name: "فتوش",
      price: "2.00",
      archived: true,
    });
    // Out of staff's sight: its category is inactive, as in GET /menu-items.
    const hidden = await createItem(s, off, {
      name: "منسف",
      price: "8.00",
      isAvailable: false,
    });
    const archivedBefore = await rowOf(archived);

    const res = await ok<EnableAllMenuItemsResponse>(enableAll(s));

    expect(res).toEqual({ enabled: 1 });
    expect((await rowOf(switchedOff)).is_available).toBe(true);
    expect((await rowOf(on)).is_available).toBe(true);
    expect(await rowOf(archived)).toEqual(archivedBefore);
    expect((await rowOf(hidden)).is_available).toBe(false);

    // Nothing left to switch on: 0, and a 200 still.
    expect(await ok<EnableAllMenuItemsResponse>(enableAll(s))).toEqual({
      enabled: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// 12 · pausing orders
// ---------------------------------------------------------------------------

describe("12 · «أوقف الطلبات مؤقتا»", () => {
  it("12. paused → ordersPausedAt in the settings; paused again → the same moment; resumed → null, and again null with a 200", async () => {
    const s = await createRestaurant(`مطعم الإيقاف ${RUN}`);
    const settings = () =>
      ok<RestaurantSettings>(call("GET", "/restaurant/settings", as(s)));
    expect((await settings()).ordersPausedAt).toBeNull();

    const paused = await ok<OrdersPauseResponse>(setPause(s, { paused: true }));
    expect(paused.ordersPausedAt).toMatch(ISO);
    expect((await settings()).ordersPausedAt).toBe(paused.ordersPausedAt);
    const stored = await pausedAt(s);
    expect(stored).not.toBeNull();

    const again = await ok<OrdersPauseResponse>(setPause(s, { paused: true }));
    expect(again.ordersPausedAt).toBe(paused.ordersPausedAt);
    expect(await pausedAt(s)).toBe(stored);

    expect(await ok(setPause(s, { paused: false }))).toEqual({
      ordersPausedAt: null,
    });
    expect((await settings()).ordersPausedAt).toBeNull();
    expect(await pausedAt(s)).toBeNull();
    expect(await ok(setPause(s, { paused: false }))).toEqual({
      ordersPausedAt: null,
    });
  });

  it("its body is { paused: boolean } and nothing else: 400, and nothing changes", async () => {
    const s = await createRestaurant(`مطعم إيقاف خاطئ ${RUN}`);

    for (const body of [
      {},
      { paused: "true" },
      { paused: 1 },
      { paused: true, ordersPausedAt: "2026-10-08T10:00:00.000Z" },
    ])
      await expectZod400(setPause(s, body));

    expect(await pausedAt(s)).toBeNull();
  });

  it("PATCH /restaurant/settings does not write it: ordersPausedAt there is a 400", async () => {
    const s = await createRestaurant(`مطعم إعدادات ${RUN}`);

    await expectZod400(
      call("PATCH", "/restaurant/settings", as(s), {
        ordersPausedAt: "2026-10-08T10:00:00.000Z",
      }),
    );

    expect(await pausedAt(s)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 13 · 🔴 isolation — the restaurant is the guard's, nowhere else's
// ---------------------------------------------------------------------------

describe("13 · 🔴 another restaurant's staff", () => {
  const asOther: As = { staff: "", restaurantId: "" };

  beforeAll(() => {
    asOther.staff = otherStaff;
    asOther.restaurantId = otherShop;
  });

  it("13a. adding to this restaurant's category under their own header: 404, and no row anywhere", async () => {
    const name = `صنف دخيل ${RUN}`;

    await expectNotFound(
      addItem(shop, { categoryId: CAT.starters, name, price: "1.00" }, asOther),
    );

    expect(await itemsNamed(name)).toEqual([]);
  });

  it("13b. 🔴 naming this restaurant in the body is a 400 — the body is no source of the restaurant — and no row anywhere", async () => {
    const name = `صنف بجسم مزوّر ${RUN}`;

    await expectZod400(
      addItem(
        shop,
        { categoryId: CAT.starters, name, price: "1.00", restaurantId: shop },
        asOther,
      ),
    );

    expect(await itemsNamed(name)).toEqual([]);
  });

  it("13c. this restaurant's header is refused by the guard — every route — and nothing changes", async () => {
    const item = await createItem(shop, CAT.starters, {
      name: `صنف محمي ${RUN}`,
      price: "1.00",
      isAvailable: false,
    });
    const before = await itemsOf(shop);
    const wrongHeader: As = { staff: otherStaff, restaurantId: shop };

    for (const res of [
      call("GET", "/menu-items", wrongHeader),
      call("GET", "/menu-items?archived=true", wrongHeader),
      call("GET", "/menu-categories", wrongHeader),
      addItem(
        shop,
        { categoryId: CAT.starters, name: `صنف ${RUN}`, price: "1.00" },
        wrongHeader,
      ),
      patchItem(shop, item, { isAvailable: true }, wrongHeader),
      patchItem(shop, item, { archived: true }, wrongHeader),
      enableAll(shop, wrongHeader),
      setPause(shop, { paused: true }, wrongHeader),
    ])
      expect((await res).status).toBe(403);

    expect(await itemsOf(shop)).toEqual(before);
    expect(await pausedAt(shop)).toBeNull();
  });

  it("13d. this restaurant's item under their own header: 404 for every change, and the item untouched", async () => {
    const item = await createItem(shop, CAT.starters, {
      name: `صنف بعيد ${RUN}`,
      price: "1.00",
    });
    const before = await rowOf(item);

    for (const body of [
      { price: "9.99" },
      { name: "اسم" },
      { isAvailable: false },
      { archived: true },
    ])
      await expectNotFound(patchItem(shop, item, body, asOther));

    expect(await rowOf(item)).toEqual(before);
  });

  it("13e. their own «شغّل الكل» and pause touch their restaurant alone", async () => {
    const item = await createItem(shop, CAT.starters, {
      name: `صنف مطفي ${RUN}`,
      price: "1.00",
      isAvailable: false,
    });

    await ok(enableAll(otherShop, asOther));
    await ok(setPause(otherShop, { paused: true }, asOther));

    expect((await rowOf(item)).is_available).toBe(false);
    expect(await pausedAt(shop)).toBeNull();
    expect(await pausedAt(otherShop)).not.toBeNull();
    await ok(setPause(otherShop, { paused: false }, asOther));
  });

  it("13f. their lists hold none of this restaurant's items or categories", async () => {
    const archived = await createItem(shop, CAT.starters, {
      name: `أرشيف محمي ${RUN}`,
      price: "1.00",
      archived: true,
    });

    const items = await ok<MenuItemListResponse>(
      call("GET", "/menu-items", asOther),
    );
    const archivedItems = await ok<ArchivedMenuItemListResponse>(
      call("GET", "/menu-items?archived=true", asOther),
    );
    const categories = await ok<MenuCategoryListResponse>(
      call("GET", "/menu-categories", asOther),
    );

    const mine = await itemsOf(shop);
    const theirIds = [...items.items, ...archivedItems.items].map((i) => i.id);
    expect(theirIds.filter((id) => mine.some((m) => m.id === id))).toEqual([]);
    expect(archivedItems.items.map((i) => i.id)).not.toContain(archived);
    expect(categories.categories).toEqual([{ id: CAT.other, name: "مقبلات" }]);
  });
});

// ---------------------------------------------------------------------------
// 14 · GET /menu-categories
// ---------------------------------------------------------------------------

describe("14 · GET /menu-categories", () => {
  it("14. the active categories alone, in the menu's order — display_order, then name", async () => {
    const s = await createRestaurant(`مطعم التصنيفات ${RUN}`);
    // Inserted out of order. «مشاوي» and «حلويات» share an order, so by name.
    const grill = await createCategory(s, "مشاوي", { displayOrder: 1 });
    await createCategory(s, "أطباق موقوفة", {
      displayOrder: 0,
      isActive: false,
    });
    const sweets = await createCategory(s, "حلويات", { displayOrder: 1 });
    const starters = await createCategory(s, "مقبلات", { displayOrder: 0 });

    const res = await ok<MenuCategoryListResponse>(
      call("GET", "/menu-categories", as(s)),
    );

    expect(res).toEqual({
      categories: [
        { id: starters, name: "مقبلات" },
        { id: sweets, name: "حلويات" },
        { id: grill, name: "مشاوي" },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// GET /menu-items — the shape added by brief ي-أ
// ---------------------------------------------------------------------------

describe("GET /menu-items — ?archived", () => {
  it("anything but true or false is a 400", async () => {
    await expectZod400(call("GET", "/menu-items?archived=yes", as(shop)));
  });

  it("archived=false is the menu, as without it", async () => {
    const plain = await menuOf(shop);
    const explicit = await ok<MenuItemListResponse>(
      call("GET", "/menu-items?archived=false", as(shop)),
    );
    expect(explicit.items).toEqual(plain);
    expect(plain.every((i: MenuItemListItem) => i.categoryName !== "")).toBe(
      true,
    );
  });
});
