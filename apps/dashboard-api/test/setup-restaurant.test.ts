/**
 * E-1 — the restaurant setup script (brief E §2 and §3).
 *
 * The script is run the way it is run by hand: as its own process, from the
 * repository root, through `src/scripts/setup-restaurant.ts`. That is the only
 * way "the output never holds the phone number id" means anything — the test
 * reads everything the process printed, not what one function returned.
 *
 * What it writes is read back through MIGRATION_DATABASE_URL, above RLS, and
 * the login it prints is used for real: `POST /auth/login` on the real
 * AppModule, then `GET /restaurant/settings` under the new restaurant.
 *
 * Every phone number id and email here carries RUN, and afterAll deletes what
 * the suite created. The seed restaurants A, B and Z are compared before and
 * after, never written.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "@jest/globals";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import type { RestaurantSettings } from "@sufria/shared";

import { AppModule } from "../src/app.module.js";
import {
  parseRestaurantConfig,
  type RestaurantConfig,
} from "../src/setup/restaurant-config.js";

const RUN = `e1-${process.pid}-${Date.now()}`;
const REPO_ROOT = resolve(__dirname, "../../..");
const SCRIPT = "apps/dashboard-api/src/scripts/setup-restaurant.ts";
const DEMO = "db/restaurants/demo.json";

/** The variable the test configs name. Its value is set per run below. */
const PHONE_VAR = "SETUP_TEST_PHONE_NUMBER_ID";

/** Digits, like a real Meta id, and unique to this run and call. */
let phoneSeq = 0;
const newPhoneId = (): string =>
  `9${Date.now()}${process.pid}${String(++phoneSeq).padStart(3, "0")}`;

const FIXTURE_RESTAURANTS = [
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
];

let app: INestApplication;
let baseUrl: string;
let audit: Pool;
let dir: string;
const usedPhoneIds: string[] = [];

const WEEK: RestaurantConfig["openingHours"] = {
  days: {
    sun: [{ open: "09:00", close: "23:00" }],
    mon: [{ open: "09:00", close: "23:00" }],
    tue: [],
    wed: [
      { open: "10:00", close: "14:00" },
      { open: "18:00", close: "23:30" },
    ],
    thu: [{ open: "09:00", close: "23:00" }],
    fri: [{ open: "13:00", close: "02:00" }],
    sat: [{ open: "09:00", close: "23:00" }],
  },
};

/**
 * A config whose file order is NOT alphabetical, in the categories and in the
 * items: a script that dropped display_order would still produce a menu, only
 * sorted by name.
 */
function config(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: `مطعم التهيئة ${RUN}`,
    currency: "ILS",
    timezone: "Asia/Gaza",
    offersDelivery: true,
    deliveryFee: "5.00",
    contactPhone: "0599123456",
    openingHours: WEEK,
    whatsappPhoneIdEnv: PHONE_VAR,
    menu: [
      {
        name: "وجبات",
        items: [
          { name: "وجبة شاورما لحمة", price: "32.00", isAvailable: true },
          { name: "وجبة شاورما دجاج", price: "25.50", isAvailable: false },
        ],
      },
      {
        name: "سندويشات",
        items: [
          { name: "فلافل", price: "5", isAvailable: true },
          { name: "شاورما لحمة", price: "20.00", isAvailable: true },
          { name: "شاورما دجاج", price: "15.00", isAvailable: true },
        ],
      },
    ],
    staff: {
      email: `owner-${RUN}-${phoneSeq}@sufria.test`,
      name: "موظف التهيئة",
      role: "owner",
    },
    ...overrides,
  };
}

let fileSeq = 0;
function writeConfig(body: unknown): string {
  const path = join(dir, `config-${++fileSeq}.json`);
  writeFileSync(path, JSON.stringify(body, null, 2));
  return path;
}

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Everything the process printed, both streams. */
  all: string;
}

/**
 * Runs the script as a process from the repository root. The environment is
 * the test's own — `.env` included, via setup-env.ts — plus `extraEnv`, so it
 * is what the script sees when run by hand after `--env-file`.
 */
function runScript(
  args: string[],
  extraEnv: Record<string, string | undefined> = {},
): Promise<Run> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
  for (const [k, v] of Object.entries(extraEnv))
    if (v === undefined) delete env[k];

  return new Promise((done, fail) => {
    const child = spawn(
      process.execPath,
      ["--import", "@swc-node/register/esm-register", SCRIPT, ...args],
      { cwd: REPO_ROOT, env },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
    child.on("error", fail);
    child.on("close", (code) =>
      done({ code, stdout, stderr, all: stdout + stderr }),
    );
  });
}

/** One real run: a fresh phone id in PHONE_VAR, the config written to disk. */
async function setup(
  body: Record<string, unknown>,
  opts: { check?: boolean; phoneId?: string } = {},
): Promise<Run & { phoneId: string }> {
  const phoneId = opts.phoneId ?? newPhoneId();
  usedPhoneIds.push(phoneId);
  const run = await runScript(
    [writeConfig(body), ...(opts.check ? ["--check"] : [])],
    { [PHONE_VAR]: phoneId },
  );
  return { ...run, phoneId };
}

const passwordIn = (stdout: string): string => {
  const match = /^\s*password:\s+(\S+)\s*$/m.exec(stdout);
  if (!match) throw new Error(`no password line in:\n${stdout}`);
  return match[1]!;
};

type Counts = Record<string, number>;
const COUNTED = [
  "restaurants",
  "menu_categories",
  "menu_items",
  "staff_accounts",
  "restaurant_staff",
];
async function counts(): Promise<Counts> {
  const out: Counts = {};
  for (const table of COUNTED) {
    const { rows } = await audit.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${table}`,
    );
    out[table] = rows[0]!.n;
  }
  return out;
}

async function restaurantByPhone(phoneId: string) {
  const { rows } = await audit.query<{
    id: string;
    name: string;
    currency: string;
    timezone: string;
    business_hours: unknown;
    offers_delivery: boolean;
    delivery_fee: string;
    contact_phone: string | null;
  }>(
    `SELECT id, name, currency, timezone, business_hours, offers_delivery,
            delivery_fee::text AS delivery_fee, contact_phone
       FROM restaurants WHERE whatsapp_phone_id = $1`,
    [phoneId],
  );
  return rows;
}

/** A, B and Z as whole rows, with their menus and memberships. */
async function fixtureSnapshot(): Promise<unknown> {
  const q = async (sql: string) =>
    (await audit.query(sql, [FIXTURE_RESTAURANTS])).rows;
  return {
    restaurants: await q(
      `SELECT to_jsonb(r) AS row FROM restaurants r WHERE id = ANY($1::uuid[]) ORDER BY id`,
    ),
    categories: await q(
      `SELECT to_jsonb(c) AS row FROM menu_categories c WHERE restaurant_id = ANY($1::uuid[]) ORDER BY id`,
    ),
    items: await q(
      `SELECT to_jsonb(i) AS row FROM menu_items i WHERE restaurant_id = ANY($1::uuid[]) ORDER BY id`,
    ),
    memberships: await q(
      `SELECT to_jsonb(m) AS row FROM restaurant_staff m WHERE restaurant_id = ANY($1::uuid[]) ORDER BY id`,
    ),
    staff: await q(
      `SELECT to_jsonb(s) AS row FROM staff_accounts s
        WHERE id IN (SELECT staff_account_id FROM restaurant_staff
                      WHERE restaurant_id = ANY($1::uuid[]))
        ORDER BY id`,
    ),
  };
}

beforeAll(async () => {
  const url = process.env["MIGRATION_DATABASE_URL"];
  if (!url)
    throw new Error(
      "MIGRATION_DATABASE_URL is missing — the script writes with it and the suite audits with it. Copy .env.example to .env.",
    );
  audit = new Pool({ connectionString: url, max: 2 });
  dir = mkdtempSync(join(tmpdir(), "sufria-setup-"));

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0);
  baseUrl = (await app.getUrl()).replace("[::1]", "127.0.0.1");
});

afterAll(async () => {
  await app?.close();
  if (audit) {
    if (usedPhoneIds.length > 0)
      await audit.query(
        `DELETE FROM restaurants WHERE whatsapp_phone_id = ANY($1::text[])`,
        [usedPhoneIds],
      );
    await audit.query(
      `DELETE FROM staff_accounts WHERE phone_or_email LIKE $1`,
      [`%-${RUN}-%@sufria.test`],
    );
    await audit.end();
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The config file — §2.2. The rules are the dashboard's own schemas, imported;
// these cases show they are wired in, and that nothing was loosened on the way.
// ---------------------------------------------------------------------------
describe("the config file", () => {
  const rejects = (body: Record<string, unknown>): string[] => {
    const result = parseRestaurantConfig(body);
    expect(result.ok).toBe(false);
    return result.ok ? [] : result.errors;
  };

  it("accepts the test config and returns it as written", () => {
    const result = parseRestaurantConfig(config());
    expect(result.ok).toBe(true);
    expect(result.ok && result.config.openingHours).toEqual(WEEK);
  });

  const week = (over: Record<string, unknown>) => ({
    days: { ...WEEK.days, ...over },
  });

  // 🔴 D-6 and D-6.1's rejections. `{}` and `{ days: {} }` first: the engine
  //    reads either as always open.
  it.each([
    ["🔴 {} — always open to the engine", {}],
    ["🔴 { days: {} } — always open to the engine", { days: {} }],
    [
      "Sunday alone — six days missing, not closed",
      { days: { sun: [{ open: "10:00", close: "23:00" }] } },
    ],
    ["a day that is null instead of []", week({ fri: null })],
    [
      '"9:00" — one-digit hour',
      week({ sun: [{ open: "9:00", close: "23:00" }] }),
    ],
    ['"24:00"', week({ sun: [{ open: "09:00", close: "24:00" }] })],
    [
      '"sunday" — a long day key',
      { days: { ...WEEK.days, sunday: [{ open: "09:00", close: "23:00" }] } },
    ],
    ["{from, to} windows", week({ sun: [{ from: "09:00", to: "23:00" }] })],
    ["a timezone key inside the hours", { ...WEEK, timezone: "Asia/Gaza" }],
  ])("rejects hours: %s", (_label, openingHours) => {
    const errors = rejects(config({ openingHours }));
    expect(errors.every((e) => e.startsWith("openingHours"))).toBe(true);
  });

  it("rejects a config without openingHours", () => {
    const body = config();
    delete body["openingHours"];
    expect(rejects(body)).toEqual([expect.stringMatching(/^openingHours: /)]);
  });

  it("accepts a window across midnight, and the demo's two-window 24-hour day", () => {
    const allDay = [
      { open: "00:00", close: "12:00" },
      { open: "12:00", close: "00:00" },
    ];
    expect(
      parseRestaurantConfig(
        config({
          openingHours: week({ fri: [{ open: "18:00", close: "02:00" }] }),
        }),
      ).ok,
    ).toBe(true);
    expect(
      parseRestaurantConfig(config({ openingHours: week({ sun: allDay }) })).ok,
    ).toBe(true);
  });

  it.each([
    ["deliveryFee", { deliveryFee: "٥.٠٠" }],
    [
      "menu.0.items.0.price",
      {
        menu: [
          {
            name: "سندويشات",
            items: [{ name: "فلافل", price: "٥", isAvailable: true }],
          },
        ],
      },
    ],
  ])("rejects Arabic-Indic digits in %s", (path, over) => {
    expect(rejects(config(over))).toEqual([
      expect.stringMatching(new RegExp(`^${path}: `)),
    ]);
  });

  it.each(["0", "0.00", "-5.00", "5.001", ""])(
    "rejects the price %p — a price is positive, as in the dashboard",
    (price) => {
      const errors = rejects(
        config({
          menu: [
            {
              name: "سندويشات",
              items: [{ name: "فلافل", price, isAvailable: true }],
            },
          ],
        }),
      );
      expect(errors).toEqual([
        expect.stringMatching(/^menu\.0\.items\.0\.price: /),
      ]);
    },
  );

  it("accepts a delivery fee of zero — free delivery, as in the dashboard", () => {
    expect(parseRestaurantConfig(config({ deliveryFee: "0" })).ok).toBe(true);
  });

  it.each([
    ["at the top", config({ ownerPhone: "0599" })],
    [
      "in the staff",
      config({
        staff: {
          email: "x@sufria.test",
          name: "س",
          role: "owner",
          password: "x",
        },
      }),
    ],
    [
      "in a category",
      config({
        menu: [
          {
            name: "س",
            displayOrder: 1,
            items: [{ name: "ف", price: "1", isAvailable: true }],
          },
        ],
      }),
    ],
    [
      "in an item",
      config({
        menu: [
          {
            name: "س",
            items: [
              { name: "ف", price: "1", isAvailable: true, description: "" },
            ],
          },
        ],
      }),
    ],
  ])("rejects an unknown field %s", (_where, body) => {
    expect(rejects(body).some((e) => /Unrecognized key/.test(e))).toBe(true);
  });

  it.each([
    ["currency", { currency: "USD" }],
    ["timezone", { timezone: "Mars/Olympus" }],
    ["timezone", { timezone: "asia/gaza" }],
    ["contactPhone", { contactPhone: "059 912 3456" }],
    [
      "staff.role",
      { staff: { email: "x@sufria.test", name: "س", role: "staff" } },
    ],
    [
      "staff.email",
      { staff: { email: "not-an-email", name: "س", role: "owner" } },
    ],
    [
      "staff.name",
      { staff: { email: "x@sufria.test", name: "  ", role: "owner" } },
    ],
    ["name", { name: "" }],
    ["menu", { menu: [] }],
    ["offersDelivery", { offersDelivery: "yes" }],
  ])("rejects a bad %s", (path, over) => {
    expect(rejects(config(over))[0]!.startsWith(`${path}: `)).toBe(true);
  });

  it("🔴 rejects a phone number id pasted where the variable's name belongs, without repeating it", () => {
    const pasted = "106540352242922";
    const errors = rejects(config({ whatsappPhoneIdEnv: pasted }));

    expect(errors).toEqual([expect.stringMatching(/^whatsappPhoneIdEnv: /)]);
    expect(errors.join("\n")).not.toContain(pasted);
  });

  it("the demo file is valid, and is the demo restaurant of brief E §2.5", () => {
    const result = parseRestaurantConfig(
      JSON.parse(readFileSync(join(REPO_ROOT, DEMO), "utf8")),
    );
    if (!result.ok) throw new Error(result.errors.join("\n"));
    const demo = result.config;

    const allDay = [
      { open: "00:00", close: "12:00" },
      { open: "12:00", close: "00:00" },
    ];
    expect(demo).toMatchObject({
      name: "سُفريا — مطعم العرض",
      currency: "ILS",
      timezone: "Asia/Gaza",
      offersDelivery: true,
      deliveryFee: "5.00",
      contactPhone: null,
      whatsappPhoneIdEnv: "WHATSAPP_PHONE_NUMBER_ID",
      staff: { email: "demo@sufria.local", name: "موظف العرض", role: "owner" },
    });
    expect(demo.openingHours.days).toEqual({
      sun: allDay,
      mon: allDay,
      tue: allDay,
      wed: allDay,
      thu: allDay,
      fri: allDay,
      sat: allDay,
    });
    expect(
      demo.menu.map((c) => [
        c.name,
        c.items.map((i) => [i.name, i.price, i.isAvailable]),
      ]),
    ).toEqual([
      [
        "سندويشات",
        [
          ["شاورما دجاج", "15.00", true],
          ["شاورما لحمة", "20.00", true],
          ["فلافل", "5.00", true],
        ],
      ],
      [
        "وجبات",
        [
          ["وجبة شاورما دجاج", "25.00", true],
          ["وجبة شاورما لحمة", "32.00", true],
        ],
      ],
      [
        "جانبي ومشروبات",
        [
          ["بطاطا", "8.00", true],
          ["حمّص", "7.00", true],
          ["مشروب غازي", "4.00", true],
        ],
      ],
    ]);
  });
});

// ---------------------------------------------------------------------------
// A real run — §2.6 and E-1's done list.
// ---------------------------------------------------------------------------
describe("a valid config", () => {
  const body = config();
  let run: Run & { phoneId: string };
  let before: unknown;

  beforeAll(async () => {
    before = await fixtureSnapshot();
    run = await setup(body);
  }, 60_000);

  it("exits 0", () => {
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
  });

  it("writes the settings literally as in the file, none left to a column default", async () => {
    const rows = await restaurantByPhone(run.phoneId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: expect.any(String),
      name: body["name"],
      currency: "ILS",
      timezone: "Asia/Gaza",
      business_hours: WEEK,
      offers_delivery: true,
      delivery_fee: "5.00",
      contact_phone: "0599123456",
    });
  });

  it("🔴 writes the menu in the file's order, as display_order, with prices and availability", async () => {
    const id = (await restaurantByPhone(run.phoneId))[0]!.id;
    const { rows } = await audit.query<{
      category: string;
      c_order: number;
      item: string;
      i_order: number;
      price: string;
      is_available: boolean;
    }>(
      `SELECT c.name AS category, c.display_order AS c_order,
              i.name AS item, i.display_order AS i_order,
              i.price::text AS price, i.is_available
         FROM menu_categories c JOIN menu_items i ON i.category_id = c.id
        WHERE c.restaurant_id = $1
        ORDER BY c.display_order, i.display_order`,
      [id],
    );

    expect(
      rows.map((r) => [r.category, r.item, r.price, r.is_available]),
    ).toEqual([
      ["وجبات", "وجبة شاورما لحمة", "32.00", true],
      ["وجبات", "وجبة شاورما دجاج", "25.50", false],
      ["سندويشات", "فلافل", "5.00", true],
      ["سندويشات", "شاورما لحمة", "20.00", true],
      ["سندويشات", "شاورما دجاج", "15.00", true],
    ]);
    // Distinct positions, so the order never falls through to the name.
    expect(rows.map((r) => [r.c_order, r.i_order])).toEqual([
      [1, 1],
      [1, 2],
      [2, 1],
      [2, 2],
      [2, 3],
    ]);
  });

  it("creates one owner, active, whose password hash is argon2id", async () => {
    const id = (await restaurantByPhone(run.phoneId))[0]!.id;
    const { rows } = await audit.query(
      `SELECT s.name, s.is_active AS account_active, s.password_hash LIKE '$argon2id$%' AS argon2id,
              m.role::text AS role, m.is_active AS membership_active
         FROM restaurant_staff m JOIN staff_accounts s ON s.id = m.staff_account_id
        WHERE m.restaurant_id = $1`,
      [id],
    );
    expect(rows).toEqual([
      {
        name: "موظف التهيئة",
        account_active: true,
        argon2id: true,
        role: "owner",
        membership_active: true,
      },
    ]);
  });

  it("🔴 the printed password logs in through the existing POST /auth/login, and reads its own restaurant's settings", async () => {
    const staff = body["staff"] as { email: string };
    const id = (await restaurantByPhone(run.phoneId))[0]!.id;

    const login = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        phoneOrEmail: staff.email,
        password: passwordIn(run.stdout),
      }),
    });
    expect(login.status).toBe(200);
    const session = (await login.json()) as {
      accessToken: string;
      restaurants: { id: string; role: string }[];
    };
    expect(session.restaurants).toEqual([
      expect.objectContaining({ id, role: "owner" }),
    ]);

    const settings = await fetch(`${baseUrl}/restaurant/settings`, {
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        "x-restaurant-id": id,
      },
    });
    expect(settings.status).toBe(200);
    expect((await settings.json()) as RestaurantSettings).toEqual({
      currency: "ILS",
      offersDelivery: true,
      deliveryFee: "5.00",
      contactPhone: "0599123456",
      openingHours: WEEK,
    });
  });

  it("prints the password once, at the end, next to the email", () => {
    const password = passwordIn(run.stdout);
    expect(run.all.split(password)).toHaveLength(2);
    const lines = run.stdout.trimEnd().split("\n");
    expect(lines.at(-1)).toMatch(/password:/);
    expect(lines.at(-2)).toContain((body["staff"] as { email: string }).email);
  });

  it("🔴 prints nothing that holds the phone number id", () => {
    expect(run.all).not.toContain(run.phoneId);
  });

  it("🔴 leaves restaurants A, B and Z exactly as they were", async () => {
    expect(await fixtureSnapshot()).toEqual(before);
  });

  // -------------------------------------------------------------------------
  // Create only — §2.1.
  // -------------------------------------------------------------------------
  it("🔴 a second run on the same phone number id is refused, by name, and nothing is added", async () => {
    const countsBefore = await counts();

    // A different email, so the phone number id is the only thing taken.
    const second = await setup(
      config({
        staff: {
          email: `second-${RUN}-x@sufria.test`,
          name: "ث",
          role: "owner",
        },
      }),
      { phoneId: run.phoneId },
    );

    expect(second.code).toBe(1);
    expect(second.stderr).toContain(
      `a restaurant already uses the phone number id in ${PHONE_VAR}`,
    );
    expect(second.all).not.toContain(run.phoneId);
    expect(await counts()).toEqual(countsBefore);
  });

  it("a run whose staff email is taken is refused, by name, and nothing is added", async () => {
    const countsBefore = await counts();

    const second = await setup(config({ staff: body["staff"] }));

    expect(second.code).toBe(1);
    expect(second.stderr).toContain(
      `a staff account already uses ${(body["staff"] as { email: string }).email}`,
    );
    expect(await counts()).toEqual(countsBefore);
  });
});

// ---------------------------------------------------------------------------
// Rejections that write nothing.
// ---------------------------------------------------------------------------
describe("writing nothing", () => {
  it("--check on a valid file succeeds and adds zero rows — without even a database URL", async () => {
    const countsBefore = await counts();

    const run = await runScript([writeConfig(config()), "--check"], {
      [PHONE_VAR]: newPhoneId(),
      MIGRATION_DATABASE_URL: undefined,
    });

    expect(run.code).toBe(0);
    expect(run.stdout).toContain("nothing was written");
    expect(run.stdout).not.toMatch(/password/);
    expect(await counts()).toEqual(countsBefore);
  });

  it("--check on the demo file succeeds", async () => {
    const phoneId = newPhoneId();
    const run = await runScript([DEMO, "--check"], {
      WHATSAPP_PHONE_NUMBER_ID: phoneId,
    });

    expect(run.code).toBe(0);
    expect(run.all).not.toContain(phoneId);
  });

  it("🔴 an invalid file is refused by the process too — { days: {} } — and adds zero rows", async () => {
    const countsBefore = await counts();

    const run = await setup(config({ openingHours: { days: {} } }));

    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/openingHours\.days/);
    expect(await counts()).toEqual(countsBefore);
  });

  it("a file that is not JSON is refused", async () => {
    const path = join(dir, "broken.json");
    writeFileSync(path, "{ name: ");
    const run = await runScript([path], { [PHONE_VAR]: newPhoneId() });

    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/cannot read .* as JSON/);
  });

  it("no config path, or two, prints the usage", async () => {
    expect((await runScript([])).stderr).toMatch(/^usage:/);
    expect((await runScript(["a.json", "b.json"])).code).toBe(1);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
  ])(
    "🔴 the phone number id variable %s is refused by its name, and the message holds no value from the environment",
    async (_label, value) => {
      const countsBefore = await counts();

      const run = await runScript([writeConfig(config())], {
        [PHONE_VAR]: value,
      });

      expect(run.code).toBe(1);
      expect(run.stderr).toContain(`the environment variable ${PHONE_VAR}`);
      // Every value the process was given, .env included — none may come back.
      const values = Object.values(process.env).filter(
        (v): v is string => typeof v === "string" && v.length >= 8,
      );
      for (const v of values) expect(run.all).not.toContain(v);
      expect(await counts()).toEqual(countsBefore);
    },
  );
});

// ---------------------------------------------------------------------------
// 🔴 All or nothing — §2.6. The failure is forced on the sixth item, after the
//    restaurant, both categories and five items are already written.
// ---------------------------------------------------------------------------
describe("a failure on a late item", () => {
  const MARKER = `بند يفشل ${RUN}`;

  afterEach(async () => {
    await audit.query(
      `DROP TRIGGER IF EXISTS sufria_test_fail_item_trg ON menu_items`,
    );
    await audit.query(`DROP FUNCTION IF EXISTS sufria_test_fail_item()`);
  });

  it("🔴 leaves no restaurant, no category, no staff account and no membership", async () => {
    await audit.query(`
      CREATE OR REPLACE FUNCTION sufria_test_fail_item() RETURNS trigger AS $$
      BEGIN
        IF NEW.name = '${MARKER}' THEN
          RAISE EXCEPTION 'sufria_test: forced failure on a late item';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await audit.query(`
      CREATE TRIGGER sufria_test_fail_item_trg
        BEFORE INSERT ON menu_items
        FOR EACH ROW EXECUTE FUNCTION sufria_test_fail_item()`);

    const countsBefore = await counts();
    const body = config({
      staff: { email: `late-${RUN}-x@sufria.test`, name: "م", role: "owner" },
    });
    const menu = body["menu"] as { items: unknown[] }[];
    menu[1]!.items.push({ name: MARKER, price: "1.00", isAvailable: true });

    const run = await setup(body);

    expect(run.code).toBe(1);
    expect(run.stderr).toContain("forced failure on a late item");
    expect(run.stderr).toContain("nothing was written");
    expect(await restaurantByPhone(run.phoneId)).toEqual([]);
    const { rows } = await audit.query(
      `SELECT 1 FROM staff_accounts WHERE phone_or_email = $1`,
      [`late-${RUN}-x@sufria.test`],
    );
    expect(rows).toEqual([]);
    expect(await counts()).toEqual(countsBefore);
  });
});
