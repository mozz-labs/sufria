/**
 * د-6 — `GET /restaurant/settings` and `PATCH /restaurant/settings` (brief D
 * §3.5, with §8.1, §8.6, §8.7 and §8.8).
 *
 * Same harness as the D-2 to D-5 suites: the real AppModule over real HTTP,
 * into Postgres as `sufria_dashboard` with RLS live, and fixtures written — and
 * audited — through MIGRATION_DATABASE_URL.
 *
 * 🔴 The hours round trip. `decideHours` lives in the engine, and dashboard-api
 *    may not import it (brief D §8.8). So the stored `business_hours` is read
 *    straight from the database and compared, literally, with the very shapes
 *    the engine's own tests feed `decideHours` in
 *    `conversation-session.test.ts` — where each one is asserted open or closed
 *    at a fixed hour — completed to seven days where they name Sunday alone,
 *    since every PATCH now carries the whole week (D-6.1). Equal to those, the engine decides on them what its tests
 *    say it decides. A writer that stored anything else — numeric day keys,
 *    `{from, to}` — would still read its own write back through GET if it
 *    mapped it back, which is why the round trip through the API alone proves
 *    nothing here.
 *
 * The suite builds its own two restaurants and puts both back to a known
 * baseline before every test. The seed is never written.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
} from "@jest/globals";
import type { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import type {
  OrderDetail,
  RestaurantSettings,
  UpdateRestaurantSettingsResponse,
} from "@sufria/shared";

import { AppModule } from "../src/app.module.js";

const RUN = `d6-${process.pid}-${Date.now()}`;
const LONG_AGO = "2026-01-01T08:00:00.000Z";

let app: INestApplication;
let baseUrl: string;
let jwt: JwtService;
let audit: Pool;

const createdRestaurants: string[] = [];
const createdStaff: string[] = [];

/** JOD, delivers for 1.50, has a contact number. */
let shopX = "";
/** ILS, no delivery, no contact number. */
let shopY = "";
let staffX = "";
let staffOnlyY = "";
let staffBoth = "";

const BASELINE_X = {
  currency: "JOD",
  offers_delivery: true,
  delivery_fee: "1.50",
  contact_phone: "+962790000099",
};
const BASELINE_Y = {
  currency: "ILS",
  offers_delivery: false,
  delivery_fee: "0.00",
  contact_phone: null,
};

/** Everything PATCH could touch, and what it must not: timezone included. */
type SettingsRow = {
  currency: string;
  offers_delivery: boolean;
  delivery_fee: string;
  contact_phone: string | null;
  business_hours: unknown;
  timezone: string;
  updated_at: string;
};

/** Every day closed — the base every week below is built on. */
const CLOSED_DAYS = {
  sun: [],
  mon: [],
  tue: [],
  wed: [],
  thu: [],
  fri: [],
  sat: [],
};

/**
 * A full week (D-6.1: all seven days, every time): `days` over a closed week.
 * Loosely typed on purpose, so a test can put one defect into an otherwise
 * valid week and the 400 has that one cause.
 */
const week = (days: Record<string, unknown>) => ({
  days: { ...CLOSED_DAYS, ...days },
});

/**
 * The shapes the engine's tests feed `decideHours`, copied literally from
 * `apps/conversation-engine/test/conversation-session.test.ts`, with what
 * those tests assert about each.
 *
 * Those that name Sunday alone are completed to seven days with `[]` (D-6.1).
 * The engine reads a missing day and `[]` alike — `hours.days[day] ?? []` —
 * and `decideHours`, run by hand for D-6.1 on each shape with and without the
 * padding, gave the same decision at every minute of a week.
 */
const ENGINE_TESTED_HOURS: [string, object][] = [
  [
    "one day, 10:00–23:00 (open Sunday 12:00, closed outside)",
    week({ sun: [{ open: "10:00", close: "23:00" }] }),
  ],
  [
    "past midnight, 22:00–02:00 (open Sunday 23:00 and Monday 01:00, closed Monday 03:00)",
    week({ sun: [{ open: "22:00", close: "02:00" }] }),
  ],
  [
    "a split shift (open 12:00 and 20:00, closed 16:00 in the gap)",
    week({
      sun: [
        { open: "10:00", close: "14:00" },
        { open: "18:00", close: "23:00" },
      ],
    }),
  ],
  [
    "a zero window, 00:00–00:00 (closed, not 24 hours)",
    week({ sun: [{ open: "00:00", close: "00:00" }] }),
  ],
  [
    "every day 00:00–23:59 (ALWAYS_OPEN_HOURS)",
    {
      days: Object.fromEntries(
        ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((d) => [
          d,
          [{ open: "00:00", close: "23:59" }],
        ]),
      ),
    },
  ],
  [
    "every day empty (ALWAYS_CLOSED_HOURS)",
    { days: { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] } },
  ],
];

const WEEK = {
  days: {
    sun: [{ open: "09:00", close: "23:00" }],
    mon: [{ open: "09:00", close: "23:00" }],
    tue: [],
    wed: [
      { open: "10:00", close: "14:00" },
      { open: "18:00", close: "23:30" },
    ],
    thu: [{ open: "09:00", close: "02:00" }],
    fri: [{ open: "13:00", close: "02:00" }],
    sat: [{ open: "09:00", close: "23:00" }],
  },
};

async function createStaff(label: string): Promise<string> {
  const { rows } = await audit.query<{ id: string }>(
    `INSERT INTO staff_accounts (phone_or_email, password_hash, name)
     VALUES ($1, 'x', $2) RETURNING id`,
    [`${label}-${RUN}@sufria.test`, `موظف ${label}`],
  );
  const id = rows[0]!.id;
  createdStaff.push(id);
  return id;
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
  const id = rows[0]!.id;
  createdRestaurants.push(id);
  return id;
}

/** Back to the baseline — `business_hours` to its default `{}`, `updated_at` far in the past. */
async function reset(
  id: string,
  b: typeof BASELINE_X | typeof BASELINE_Y,
): Promise<void> {
  await audit.query(
    `UPDATE restaurants
        SET currency = $2, offers_delivery = $3, delivery_fee = $4::numeric,
            contact_phone = $5, business_hours = '{}'::jsonb,
            timezone = 'Asia/Amman', updated_at = $6::timestamptz
      WHERE id = $1`,
    [
      id,
      b.currency,
      b.offers_delivery,
      b.delivery_fee,
      b.contact_phone,
      LONG_AGO,
    ],
  );
}

/** The restaurant as the database holds it — asked above RLS, never through the API. */
async function rowOf(id: string): Promise<SettingsRow> {
  const { rows } = await audit.query<SettingsRow>(
    `SELECT currency, offers_delivery, delivery_fee::text AS delivery_fee,
            contact_phone, business_hours, timezone,
            updated_at::text AS updated_at
       FROM restaurants WHERE id = $1`,
    [id],
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

const getSettings = (opts: { staff?: string; restaurantId?: string }) =>
  fetch(`${baseUrl}/restaurant/settings`, { headers: headers(opts) });

async function settingsOk(
  staff: string,
  restaurantId: string,
): Promise<RestaurantSettings> {
  const res = await getSettings({ staff, restaurantId });
  expect(res.status).toBe(200);
  return (await res.json()) as RestaurantSettings;
}

function patchSettings(
  body: unknown,
  opts: { staff?: string; restaurantId?: string },
): Promise<Response> {
  return fetch(`${baseUrl}/restaurant/settings`, {
    method: "PATCH",
    headers: headers(opts),
    body: JSON.stringify(body),
  });
}

/** A PATCH to restaurant X by its own staff. */
const patchX = (body: unknown) =>
  patchSettings(body, { staff: staffX, restaurantId: shopX });

async function patchXOk(
  body: unknown,
): Promise<UpdateRestaurantSettingsResponse> {
  const res = await patchX(body);
  expect(res.status).toBe(200);
  return (await res.json()) as UpdateRestaurantSettingsResponse;
}

/** §8.7: nestjs-zod's existing 400, as the D-4 and D-5 suites check it. */
async function expectZod400(res: Response): Promise<void> {
  expect(res.status).toBe(400);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body["statusCode"]).toBe(400);
  expect(body["message"]).toBe("Validation failed");
  expect(Array.isArray(body["errors"])).toBe(true);
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

  shopX = await createRestaurant("d6-x");
  shopY = await createRestaurant("d6-y");
  staffX = await createStaff("d6-x");
  await addMember(staffX, shopX);
  staffOnlyY = await createStaff("d6-only-y");
  await addMember(staffOnlyY, shopY);
  staffBoth = await createStaff("d6-both");
  await addMember(staffBoth, shopX);
  await addMember(staffBoth, shopY);
});

beforeEach(async () => {
  await reset(shopX, BASELINE_X);
  await reset(shopY, BASELINE_Y);
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
// GET /restaurant/settings — brief D §3.5.
// ---------------------------------------------------------------------------
describe("GET /restaurant/settings", () => {
  it("returns the five fields and nothing else, money as the database's text", async () => {
    expect(await settingsOk(staffX, shopX)).toEqual({
      currency: "JOD",
      offersDelivery: true,
      deliveryFee: "1.50",
      contactPhone: "+962790000099",
      openingHours: {},
    });
    expect(await settingsOk(staffOnlyY, shopY)).toEqual({
      currency: "ILS",
      offersDelivery: false,
      deliveryFee: "0.00",
      contactPhone: null,
      openingHours: {},
    });
  });

  it("returns the stored hours as they are", async () => {
    await audit.query(
      `UPDATE restaurants SET business_hours = $2::jsonb WHERE id = $1`,
      [shopX, JSON.stringify(WEEK)],
    );

    expect((await settingsOk(staffX, shopX)).openingHours).toEqual(WEEK);
  });

  // 🔴 Isolation — brief §8.1. There is no id to guess: the header is the only
  //    way to name a restaurant, and the guard checks it.
  it("🔴 dual-branch staff gets X's settings under X's header and Y's under Y's", async () => {
    expect((await settingsOk(staffBoth, shopX)).currency).toBe("JOD");
    expect((await settingsOk(staffBoth, shopY)).currency).toBe("ILS");
  });

  it("Y-only staff sending X's header is refused by the guard, with no settings in the body", async () => {
    const res = await getSettings({ staff: staffOnlyY, restaurantId: shopX });

    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["deliveryFee"]).toBeUndefined();
    expect(body["contactPhone"]).toBeUndefined();
  });

  it("rejects a request without a token with 401", async () => {
    const res = await getSettings({ restaurantId: shopX });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH, field by field and all together — brief D §3.5 with §8.6.
// ---------------------------------------------------------------------------
describe("PATCH /restaurant/settings — fields", () => {
  it("deliveryFee alone: written as numeric, everything else untouched, updated_at stamped", async () => {
    const before = await rowOf(shopX);

    const body = await patchXOk({ deliveryFee: "2.25" });

    const after = await rowOf(shopX);
    expect(after).toEqual({
      ...before,
      delivery_fee: "2.25",
      updated_at: after.updated_at,
    });
    expect(after.updated_at > before.updated_at).toBe(true);
    expect(body.deliveryFee).toBe("2.25");
  });

  it.each([
    ["0", "0.00"],
    ["0.00", "0.00"],
    ["3.5", "3.50"],
    ["999999.99", "999999.99"],
  ])(
    "deliveryFee %s comes back as the database's text %s — zero is a real fee",
    async (sent, stored) => {
      const body = await patchXOk({ deliveryFee: sent });

      expect(body.deliveryFee).toBe(stored);
      expect((await rowOf(shopX)).delivery_fee).toBe(stored);
    },
  );

  it("contactPhone alone: everything else untouched", async () => {
    const before = await rowOf(shopX);

    await patchXOk({ contactPhone: "+970599123456" });

    const after = await rowOf(shopX);
    expect(after).toEqual({
      ...before,
      contact_phone: "+970599123456",
      updated_at: after.updated_at,
    });
  });

  it("openingHours alone: everything else untouched, the timezone column included", async () => {
    const before = await rowOf(shopX);

    await patchXOk({ openingHours: WEEK });

    const after = await rowOf(shopX);
    expect(after).toEqual({
      ...before,
      business_hours: WEEK,
      updated_at: after.updated_at,
    });
  });

  it("all three together, and the reply is the settings as GET returns them", async () => {
    const body = await patchXOk({
      deliveryFee: "1.75",
      contactPhone: "+962781112233",
      openingHours: WEEK,
    });

    expect(await rowOf(shopX)).toMatchObject({
      delivery_fee: "1.75",
      contact_phone: "+962781112233",
      business_hours: WEEK,
      currency: "JOD",
      offers_delivery: true,
    });
    expect(body).toEqual(await settingsOk(staffX, shopX));
  });
});

// ---------------------------------------------------------------------------
// 🔴 The hours round trip — brief D §8.8. Compared with the database, not with
//    GET, and with the engine's own tested shapes, not with the request.
// ---------------------------------------------------------------------------
describe("PATCH /restaurant/settings — the hours round trip", () => {
  it.each(ENGINE_TESTED_HOURS)(
    "🔴 %s is stored exactly as the engine's tests shape it",
    async (_label, hours) => {
      await patchXOk({ openingHours: hours });

      expect((await rowOf(shopX)).business_hours).toEqual(hours);
      expect((await settingsOk(staffX, shopX)).openingHours).toEqual(hours);
    },
  );

  it("🔴 a full week is stored day key by day key, with {open, close} and two-digit hours", async () => {
    await patchXOk({ openingHours: WEEK });

    const stored = (await rowOf(shopX)).business_hours as {
      days: Record<string, { open: string; close: string }[]>;
    };
    expect(Object.keys(stored)).toEqual(["days"]);
    expect(Object.keys(stored.days).sort()).toEqual([
      "fri",
      "mon",
      "sat",
      "sun",
      "thu",
      "tue",
      "wed",
    ]);
    expect(stored).toEqual(WEEK);
  });

  it("the whole week replaces what was stored — a hand-written legacy row keeps neither its timezone key nor its long day key", async () => {
    // What a row written by hand before the settings screen may hold: forms
    // only the engine's lenient reader accepts. A merge (`||`, or day by day)
    // would keep them next to the new week.
    await audit.query(
      `UPDATE restaurants SET business_hours = $2::jsonb WHERE id = $1`,
      [
        shopX,
        JSON.stringify({
          timezone: "Asia/Amman",
          days: { sunday: [{ open: "9:00", close: "23:00" }] },
        }),
      ],
    );

    await patchXOk({ openingHours: WEEK });

    expect((await rowOf(shopX)).business_hours).toEqual(WEEK);
  });

  // D-6.1 — the engine reads it as it should, and the writer takes it as is.
  it("🔴 a window across midnight, 18:00 → 02:00, is accepted and stored as sent (the engine keeps it open to 01:59 on Monday)", async () => {
    const hours = week({ sun: [{ open: "18:00", close: "02:00" }] });

    await patchXOk({ openingHours: hours });

    expect((await rowOf(shopX)).business_hours).toEqual(hours);
  });
});

// ---------------------------------------------------------------------------
// 🔴 D-6.1 — all seven days, in every PATCH. The engine reads a week in which
//    it recognises no day as always open; the dashboard may never write one.
// ---------------------------------------------------------------------------
describe("PATCH /restaurant/settings — all seven days", () => {
  it.each([
    [
      "🔴 { days: {} } — no day at all, always open to the engine",
      { days: {} },
    ],
    ["🔴 {} — the column default, always open to the engine", {}],
    [
      "Sunday alone — the other six missing, not closed",
      { days: { sun: [{ open: "10:00", close: "23:00" }] } },
    ],
    ["a day that is null instead of []", week({ fri: null })],
  ])("rejects %s with 400, and nothing is written", async (_label, hours) => {
    const before = await rowOf(shopX);

    await expectZod400(await patchX({ openingHours: hours }));

    expect(await rowOf(shopX)).toEqual(before);
  });

  it.each(Object.keys(CLOSED_DAYS))(
    "rejects a week without %s with 400 — every key is required, not only some",
    async (day) => {
      const before = await rowOf(shopX);
      const days: Record<string, unknown> = { ...WEEK.days };
      delete days[day];

      await expectZod400(await patchX({ openingHours: { days } }));

      expect(await rowOf(shopX)).toEqual(before);
    },
  );

  it("a closed day is [] and is stored as []", async () => {
    await patchXOk({ openingHours: WEEK });

    expect(
      ((await rowOf(shopX)).business_hours as typeof WEEK).days.tue,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 🔴 Strict writer, lenient reader — brief D §8.8. What the engine accepts only
//    out of tolerance is a 400 here, and nothing is written.
// ---------------------------------------------------------------------------
describe("PATCH /restaurant/settings — strict hours", () => {
  // One defect inside an otherwise valid week, so the 400 has that one cause
  // and not the missing days (D-6.1).
  const sunday = (w: unknown) => ({ openingHours: week({ sun: [w] }) });
  const extraDay = (key: string) => ({
    openingHours: week({ [key]: [{ open: "09:00", close: "23:00" }] }),
  });

  it.each([
    ['🔴 "9:00" — one-digit hour', sunday({ open: "9:00", close: "23:00" })],
    ['🔴 "sunday" — the long day key', extraDay("sunday")],
    ['"Sun" — a capital', extraDay("Sun")],
    ['a numeric day key "0"', extraDay("0")],
    [
      "{from, to} instead of {open, close}",
      sunday({ from: "09:00", to: "23:00" }),
    ],
    [
      "a window with an extra key",
      sunday({ open: "09:00", close: "23:00", note: "x" }),
    ],
    ["a window without close", sunday({ open: "09:00" })],
    ['"24:00"', sunday({ open: "09:00", close: "24:00" })],
    ['"09:00:00" — seconds', sunday({ open: "09:00:00", close: "23:00" })],
    [
      '"٠٩:٠٠" — Arabic-Indic digits',
      sunday({ open: "٠٩:٠٠", close: "23:00" }),
    ],
    ["a time that is a number", sunday({ open: 900, close: "23:00" })],
    [
      "a timezone key inside the hours (moved to its own column by 0008)",
      {
        openingHours: {
          timezone: "Asia/Amman",
          ...week({ sun: [{ open: "09:00", close: "23:00" }] }),
        },
      },
    ],
    ["days that is an array", { openingHours: { days: [] } }],
    [
      "a day that is one window, not a list",
      { openingHours: week({ sun: { open: "09:00", close: "23:00" } }) },
    ],
    ["null hours", { openingHours: null }],
  ])("rejects %s with 400, and nothing is written", async (_label, body) => {
    const before = await rowOf(shopX);

    await expectZod400(await patchX(body));

    expect(await rowOf(shopX)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// 🔴 Arabic-Indic digits in the fee — brief D §0, a test by name.
// ---------------------------------------------------------------------------
describe("PATCH /restaurant/settings — Arabic-Indic digits", () => {
  it.each([
    ["١.٥٠", "Arabic-Indic digits"],
    ["٠", "a single Arabic-Indic zero"],
    ["1.٥0", "Western and Arabic-Indic mixed"],
    ["۱.۵۰", "Persian (Extended Arabic-Indic) digits"],
    ["1٫50", "the Arabic decimal separator"],
  ])(
    "🔴 rejects deliveryFee %s (%s) with 400, and the fee is untouched",
    async (deliveryFee) => {
      const before = await rowOf(shopX);

      await expectZod400(await patchX({ deliveryFee }));

      expect(await rowOf(shopX)).toEqual(before);
    },
  );
});

// ---------------------------------------------------------------------------
// Input — 400 in nestjs-zod's existing shape (§8.7), and nothing written.
// ---------------------------------------------------------------------------
describe("PATCH /restaurant/settings — input", () => {
  it.each([
    ["🔴 currency — set at onboarding, never from here", { currency: "ILS" }],
    ["🔴 offersDelivery — read-only (§2.10)", { offersDelivery: false }],
    [
      "timezone — not editable from the dashboard (§8.8)",
      { timezone: "Asia/Gaza" },
    ],
    [
      "currency next to a valid field — the valid one is not written either",
      { deliveryFee: "2.00", currency: "ILS" },
    ],
    [
      "offersDelivery next to a valid field",
      { contactPhone: "+962781112233", offersDelivery: false },
    ],
    [
      "a key the contract does not have (restaurantId)",
      { restaurantId: "x", deliveryFee: "2.00" },
    ],
    ["an empty body", {}],
    ["a negative fee", { deliveryFee: "-1.00" }],
    ["a fee with three decimals", { deliveryFee: "1.505" }],
    ["a fee that is a number, not text", { deliveryFee: 1.5 }],
    ["an empty fee", { deliveryFee: "" }],
    ["a fee in exponent notation", { deliveryFee: "1e2" }],
    ["a fee of seven integer digits", { deliveryFee: "1234567" }],
    ["a null fee", { deliveryFee: null }],
    ["a phone with spaces", { contactPhone: "+962 79 000 0099" }],
    ["a local phone with spaces", { contactPhone: "079 000 0099" }],
    ["a phone with dashes", { contactPhone: "079-000-0099" }],
    ["a phone with a space at the end", { contactPhone: "0790000099 " }],
    ["a phone with two pluses", { contactPhone: "++962790000099" }],
    ["a plus that is not at the start", { contactPhone: "0790+000099" }],
    ["a plus alone", { contactPhone: "+" }],
    ["an empty phone", { contactPhone: "" }],
    ["a phone of six digits", { contactPhone: "079000" }],
    ["a phone of six digits after the plus", { contactPhone: "+962790" }],
    ["a phone of sixteen digits", { contactPhone: "+9627900000991234" }],
    ["a phone that is a number, not text", { contactPhone: 790000099 }],
    [
      "🔴 a phone in Arabic-Indic digits, international form",
      { contactPhone: "+٩٦٢٧٩٠٠٠٠٠٩٩" },
    ],
    [
      "🔴 a phone in Arabic-Indic digits, local form",
      { contactPhone: "٠٧٩٠٠٠٠٠٩٩" },
    ],
    [
      "a phone mixing Western and Arabic-Indic digits",
      { contactPhone: "07٩0000099" },
    ],
  ])("rejects %s with 400, and nothing is written", async (_label, body) => {
    const before = await rowOf(shopX);

    await expectZod400(await patchX(body));

    expect(await rowOf(shopX)).toEqual(before);
  });

  it("rejects a request without a token with 401", async () => {
    const res = await patchSettings(
      { deliveryFee: "2.00" },
      { restaurantId: shopX },
    );
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// D-6.1 — contactPhone: local and international forms, and null clears it.
// ---------------------------------------------------------------------------
describe("PATCH /restaurant/settings — contactPhone", () => {
  it.each([
    ["0790000099", "a Jordanian mobile, local form — as the seed holds it"],
    ["0599123456", "a Palestinian mobile, local form"],
    ["+962790000099", "international form"],
    ["+970599123456", "international form, Palestine"],
    ["1234567", "seven digits, the shortest"],
    ["+123456789012345", "fifteen digits after the plus, the longest"],
  ])("accepts %s (%s) and stores it exactly as sent", async (phone) => {
    const body = await patchXOk({ contactPhone: phone });

    expect(body.contactPhone).toBe(phone);
    expect((await rowOf(shopX)).contact_phone).toBe(phone);
  });

  it("🔴 null clears the number — stored NULL, GET says null, nothing else touched", async () => {
    const before = await rowOf(shopX);
    expect(before.contact_phone).not.toBeNull();

    const body = await patchXOk({ contactPhone: null });

    const after = await rowOf(shopX);
    expect(after).toEqual({
      ...before,
      contact_phone: null,
      updated_at: after.updated_at,
    });
    expect(body.contactPhone).toBeNull();
    expect((await settingsOk(staffX, shopX)).contactPhone).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 🔴 Isolation — brief §8.1 and D-6: staff of Y sends a PATCH, X is unchanged.
// ---------------------------------------------------------------------------
describe("PATCH /restaurant/settings — isolation", () => {
  const change = {
    deliveryFee: "4.00",
    contactPhone: "+970599000001",
    openingHours: WEEK,
  };

  it("🔴 Y's staff patches under Y's header: Y changes, X's settings do not", async () => {
    const beforeX = await rowOf(shopX);

    const res = await patchSettings(change, {
      staff: staffOnlyY,
      restaurantId: shopY,
    });

    expect(res.status).toBe(200);
    expect(await rowOf(shopY)).toMatchObject({
      delivery_fee: "4.00",
      contact_phone: "+970599000001",
    });
    expect(await rowOf(shopX)).toEqual(beforeX);
  });

  it("🔴 Y-only staff sending X's header is refused by the guard, and X's settings do not change", async () => {
    const beforeX = await rowOf(shopX);

    const res = await patchSettings(change, {
      staff: staffOnlyY,
      restaurantId: shopX,
    });

    expect(res.status).toBe(403);
    expect(await rowOf(shopX)).toEqual(beforeX);
  });

  it("dual-branch staff under Y's header changes Y alone", async () => {
    const beforeX = await rowOf(shopX);

    const res = await patchSettings(change, {
      staff: staffBoth,
      restaurantId: shopY,
    });

    expect(res.status).toBe(200);
    expect((await rowOf(shopY)).delivery_fee).toBe("4.00");
    expect(await rowOf(shopX)).toEqual(beforeX);
  });
});

// ---------------------------------------------------------------------------
// «الرسوم وعد» — a new fee does not reach an order already placed.
// ---------------------------------------------------------------------------
describe("PATCH /restaurant/settings — the fee is a promise", () => {
  it("a new delivery fee leaves an existing delivery order at its old fee, through GET /orders/:id", async () => {
    const customer = await audit.query<{ id: string }>(
      `INSERT INTO customers (restaurant_id, phone_number) VALUES ($1, '+962790000006')
       RETURNING id`,
      [shopX],
    );
    const order = await audit.query<{ id: string }>(
      `INSERT INTO orders (restaurant_id, customer_id, order_number, fulfillment_type,
                           payment_method, status, payment_status, subtotal,
                           delivery_fee, total, delivery_address)
       VALUES ($1, $2, 101, 'delivery', 'cash', 'pending_acceptance', 'pending_cash',
               5.00, 1.50, 6.50, 'شارع الجامعة، بناية 12')
       RETURNING id`,
      [shopX, customer.rows[0]!.id],
    );

    await patchXOk({ deliveryFee: "2.50" });
    expect((await rowOf(shopX)).delivery_fee).toBe("2.50");

    const res = await fetch(`${baseUrl}/orders/${order.rows[0]!.id}`, {
      headers: headers({ staff: staffX, restaurantId: shopX }),
    });
    expect(res.status).toBe(200);
    const detail = (await res.json()) as OrderDetail;
    expect(detail.deliveryFee).toBe("1.50");
    expect(detail.total).toBe("6.50");
  });
});
