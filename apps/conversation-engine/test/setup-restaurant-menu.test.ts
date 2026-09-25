/**
 * E-1 — the menu a restaurant created by the setup script shows the customer
 * is in the order of its config file, not alphabetical (brief E §2.2).
 *
 * The script lives in dashboard-api (`src/scripts/setup-restaurant.ts`) and is
 * run here as its own process — the way it is run by hand — never imported.
 * What is asserted is the engine's side: `buildMenu`, under the restaurant's
 * RLS context, as `sufria_engine`.
 *
 * 🔴 Why this is a separate test from dashboard-api's: the order the customer
 *    sees comes from the engine's `ORDER BY display_order, name, id`. If the
 *    script left display_order at its default of 0, the menu would still be
 *    complete and every row still correct — only sorted by name. The file
 *    below is deliberately NOT in alphabetical order, in the categories and in
 *    the items, so that failure cannot hide.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Pool } from "pg";

import { TenantDb } from "../src/db/tenant-db.js";
import { buildMenu } from "../src/restaurant/menu.js";

const RUN = `e1-menu-${process.pid}-${Date.now()}`;
const REPO_ROOT = resolve(__dirname, "../../..");
const SCRIPT = "apps/dashboard-api/src/scripts/setup-restaurant.ts";
const PHONE_VAR = "SETUP_TEST_PHONE_NUMBER_ID";
const PHONE_ID = `8${Date.now()}${process.pid}`;
const EMAIL = `owner-${RUN}@sufria.test`;

const ALL_DAY = [
  { open: "00:00", close: "12:00" },
  { open: "12:00", close: "00:00" },
];

/** In file order. Reverse-alphabetical at both levels. */
const MENU = [
  {
    name: "وجبات",
    items: [
      { name: "وجبة شاورما لحمة", price: "32.00", isAvailable: true },
      { name: "وجبة شاورما دجاج", price: "25.00", isAvailable: true },
    ],
  },
  {
    name: "سندويشات",
    items: [
      { name: "فلافل", price: "5.00", isAvailable: true },
      { name: "شاورما لحمة", price: "20.00", isAvailable: true },
      { name: "شاورما دجاج", price: "15.00", isAvailable: true },
    ],
  },
  {
    name: "جانبي ومشروبات",
    items: [
      { name: "مشروب غازي", price: "4.00", isAvailable: true },
      { name: "حمّص", price: "7.00", isAvailable: true },
      { name: "بطاطا", price: "8.00", isAvailable: true },
    ],
  },
];
const FILE_ORDER = MENU.flatMap((c) => c.items.map((i) => i.name));

let audit: Pool;
let db: TenantDb;
let dir: string;
let restaurantId: string;

function runScript(configPath: string): Promise<{
  code: number | null;
  output: string;
}> {
  return new Promise((done, fail) => {
    const child = spawn(
      process.execPath,
      ["--import", "@swc-node/register/esm-register", SCRIPT, configPath],
      { cwd: REPO_ROOT, env: { ...process.env, [PHONE_VAR]: PHONE_ID } },
    );
    let output = "";
    child.stdout.on("data", (b: Buffer) => (output += b.toString()));
    child.stderr.on("data", (b: Buffer) => (output += b.toString()));
    child.on("error", fail);
    child.on("close", (code) => done({ code, output }));
  });
}

beforeAll(async () => {
  const url = process.env["MIGRATION_DATABASE_URL"];
  if (!url)
    throw new Error(
      "MIGRATION_DATABASE_URL is missing — the setup script writes with it. Copy .env.example to .env.",
    );
  audit = new Pool({ connectionString: url, max: 1 });
  db = new TenantDb();
  await db.start();

  dir = mkdtempSync(join(tmpdir(), "sufria-setup-menu-"));
  const configPath = join(dir, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      name: `مطعم الترتيب ${RUN}`,
      currency: "ILS",
      timezone: "Asia/Gaza",
      offersDelivery: false,
      deliveryFee: "0",
      contactPhone: null,
      openingHours: {
        days: {
          sun: ALL_DAY,
          mon: ALL_DAY,
          tue: ALL_DAY,
          wed: ALL_DAY,
          thu: ALL_DAY,
          fri: ALL_DAY,
          sat: ALL_DAY,
        },
      },
      whatsappPhoneIdEnv: PHONE_VAR,
      menu: MENU,
      staff: { email: EMAIL, name: "موظف الترتيب", role: "owner" },
    }),
  );

  const run = await runScript(configPath);
  if (run.code !== 0)
    throw new Error(`setup script exited ${run.code}:\n${run.output}`);

  const { rows } = await audit.query<{ id: string }>(
    `SELECT id FROM restaurants WHERE whatsapp_phone_id = $1`,
    [PHONE_ID],
  );
  restaurantId = rows[0]!.id;
}, 60_000);

afterAll(async () => {
  if (audit) {
    await audit.query(`DELETE FROM restaurants WHERE whatsapp_phone_id = $1`, [
      PHONE_ID,
    ]);
    await audit.query(`DELETE FROM staff_accounts WHERE phone_or_email = $1`, [
      EMAIL,
    ]);
    await audit.end();
  }
  await db?.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("a restaurant created by the setup script, as the engine sees it", () => {
  it("the file is not in alphabetical order — otherwise this suite proves nothing", () => {
    const sorted = [...FILE_ORDER].sort((a, b) => a.localeCompare(b, "ar"));
    expect(FILE_ORDER).not.toEqual(sorted);
  });

  it("🔴 numbers the menu in the file's order, categories and items alike", async () => {
    const menu = await db.runInTenant(restaurantId, (tx) =>
      buildMenu(tx, "ILS"),
    );

    expect(menu.lines.map((l) => [l.number, l.name])).toEqual(
      FILE_ORDER.map((name, i) => [i + 1, name]),
    );

    // The category headings in the text follow the file too.
    const headings = MENU.map((c) => menu.text.indexOf(`\n${c.name}\n`));
    expect(headings.every((at) => at > -1)).toBe(true);
    expect([...headings].sort((a, b) => a - b)).toEqual(headings);
  });
});
