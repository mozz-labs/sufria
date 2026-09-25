import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as argon2 from "argon2";
import { Client } from "pg";

import {
  parseRestaurantConfig,
  type RestaurantConfig,
} from "./restaurant-config.js";

/**
 * Creates one complete restaurant from a config file — brief E.
 *
 *   setup-restaurant <config.json> [--check]
 *
 * Create only. A restaurant already on the same phone number id, or a staff
 * account already on the same email, is a rejection and nothing is written:
 * changing a restaurant afterwards is the dashboard's job (brief D).
 *
 * 🔴 Secrets. The config holds the NAME of the variable with the phone number
 *    id, and the id itself is read from the environment and never printed —
 *    not on success, not in an error. The staff password is generated here,
 *    printed once at the very end, and stored nowhere but as its hash.
 *
 * Connects as MIGRATION_DATABASE_URL, the role `pnpm db:seed` writes with
 * (brief E §0): a restaurant row cannot be created under RLS by the app roles
 * without first naming it as the tenant context.
 */

export interface SetupIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

const USAGE =
  "usage: setup-restaurant <path/to/config.json> [--check]\n" +
  "  --check  validate the file and the environment, write nothing";

/** Exit status: 0 done, 1 rejected or failed — in both cases nothing written. */
export async function setupRestaurant(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  io: SetupIo,
): Promise<number> {
  const check = argv.includes("--check");
  const positional = argv.filter((a) => a !== "--check");
  const path = positional[0];
  if (positional.length !== 1 || path === undefined || path.startsWith("-")) {
    io.err(USAGE);
    return 1;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    io.err(`✗ cannot read ${path} as JSON: ${messageOf(error)}`);
    return 1;
  }

  const parsed = parseRestaurantConfig(raw);
  if (!parsed.ok) {
    io.err(`✗ ${path} is not a valid restaurant config:`);
    for (const line of parsed.errors) io.err(`  - ${line}`);
    return 1;
  }
  const config = parsed.config;

  // 🔴 Only the variable's name ever appears in a message, never its value.
  const phoneNumberId = env[config.whatsappPhoneIdEnv]?.trim() ?? "";
  if (phoneNumberId === "") {
    io.err(
      `✗ the environment variable ${config.whatsappPhoneIdEnv} is not set or is empty — it must hold the WhatsApp phone number id`,
    );
    return 1;
  }

  if (check) {
    io.out(`✓ ${path} is valid — nothing was written`);
    io.out(`  ${summary(config)}`);
    io.out(`  phone number id: read from ${config.whatsappPhoneIdEnv}`);
    return 0;
  }

  const url = env["MIGRATION_DATABASE_URL"];
  if (!url) {
    io.err(
      "✗ MIGRATION_DATABASE_URL is not set — the script writes with the role db:seed uses",
    );
    return 1;
  }

  // Hashed before the transaction opens, so it holds no locks while argon2
  // works. Same library and the same call as the refresh-token hash in
  // auth.service.ts; `argon2.verify` at login reads its parameters from the
  // hash itself.
  const password = randomBytes(18).toString("base64url");
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const client = new Client({ connectionString: url });
  let restaurantId: string;
  try {
    await client.connect();
    const outcome = await createInOneTransaction(
      client,
      config,
      phoneNumberId,
      passwordHash,
    );
    if (!outcome.ok) {
      io.err(`✗ ${outcome.reason} — nothing was written`);
      return 1;
    }
    restaurantId = outcome.restaurantId;
  } catch (error) {
    // 🔴 `message` only, never `detail`: a unique violation's detail spells
    //    out the key — `Key (whatsapp_phone_id)=(…) already exists` — which
    //    is the id this script must never print.
    io.err(`✗ setup failed, nothing was written: ${messageOf(error)}`);
    return 1;
  } finally {
    await client.end().catch(() => undefined);
  }

  io.out(`✓ restaurant created: ${config.name}`);
  io.out(`  id: ${restaurantId}`);
  io.out(`  ${summary(config)}`);
  io.out(`  phone number id: from ${config.whatsappPhoneIdEnv}`);
  io.out("");
  io.out("Staff login — the password is shown this once and stored nowhere:");
  io.out(`  email:    ${config.staff.email}`);
  io.out(`  password: ${password}`);
  return 0;
}

type Outcome =
  { ok: true; restaurantId: string } | { ok: false; reason: string };

/**
 * 🔴 All or nothing (§2.6): the restaurant, its menu, the staff account and
 *    the membership commit together or not at all. A failure on the fifth
 *    item leaves no restaurant, no category and no staff account behind.
 */
async function createInOneTransaction(
  client: Client,
  config: RestaurantConfig,
  phoneNumberId: string,
  passwordHash: string,
): Promise<Outcome> {
  await client.query("BEGIN");
  try {
    const outcome = await create(client, config, phoneNumberId, passwordHash);
    await client.query(outcome.ok ? "COMMIT" : "ROLLBACK");
    return outcome;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function create(
  client: Client,
  config: RestaurantConfig,
  phoneNumberId: string,
  passwordHash: string,
): Promise<Outcome> {
  // Checked first for a clear message. The UNIQUE constraints on both columns
  // are what actually hold under a race; this only names the problem.
  const phoneTaken = await client.query(
    "SELECT 1 FROM restaurants WHERE whatsapp_phone_id = $1",
    [phoneNumberId],
  );
  if (phoneTaken.rowCount !== 0) {
    return {
      ok: false,
      reason: `a restaurant already uses the phone number id in ${config.whatsappPhoneIdEnv}. This script only creates; change an existing restaurant from the dashboard`,
    };
  }

  // phone_or_email is citext, so this compares case-insensitively, as the
  // column's UNIQUE does.
  const emailTaken = await client.query(
    "SELECT 1 FROM staff_accounts WHERE phone_or_email = $1",
    [config.staff.email],
  );
  if (emailTaken.rowCount !== 0) {
    return {
      ok: false,
      reason: `a staff account already uses ${config.staff.email}`,
    };
  }

  // Every setting is written explicitly, none left to a column default:
  // timezone defaults to Asia/Amman, currency to JOD, and business_hours to
  // `{}`, which the engine reads as always open.
  const restaurant = await client.query<{ id: string }>(
    `INSERT INTO restaurants
       (name, whatsapp_phone_id, currency, timezone, business_hours,
        offers_delivery, delivery_fee, contact_phone)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::numeric(12,2), $8)
     RETURNING id`,
    [
      config.name,
      phoneNumberId,
      config.currency,
      config.timezone,
      JSON.stringify(config.openingHours),
      config.offersDelivery,
      config.deliveryFee,
      config.contactPhone,
    ],
  );
  const restaurantId = restaurant.rows[0]!.id;

  // 🔴 display_order is the position in the file. Left at its default of 0,
  //    the engine's ORDER BY falls through to the name, and the customer gets
  //    the menu alphabetically instead of as the restaurant wrote it.
  for (const [c, category] of config.menu.entries()) {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO menu_categories (restaurant_id, name, display_order)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [restaurantId, category.name, c + 1],
    );
    const categoryId = inserted.rows[0]!.id;

    for (const [i, item] of category.items.entries()) {
      await client.query(
        `INSERT INTO menu_items
           (restaurant_id, category_id, name, price, is_available, display_order)
         VALUES ($1, $2, $3, $4::numeric(12,2), $5, $6)`,
        [
          restaurantId,
          categoryId,
          item.name,
          item.price,
          item.isAvailable,
          i + 1,
        ],
      );
    }
  }

  const staff = await client.query<{ id: string }>(
    `INSERT INTO staff_accounts (phone_or_email, password_hash, name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [config.staff.email, passwordHash, config.staff.name],
  );

  await client.query(
    `INSERT INTO restaurant_staff (staff_account_id, restaurant_id, role, is_active)
     VALUES ($1, $2, $3, true)`,
    [staff.rows[0]!.id, restaurantId, config.staff.role],
  );

  return { ok: true, restaurantId };
}

function summary(config: RestaurantConfig): string {
  const items = config.menu.reduce((n, c) => n + c.items.length, 0);
  return `${config.name} · ${config.currency} · ${config.timezone} · ${config.menu.length} categories, ${items} items · staff ${config.staff.email} (${config.staff.role})`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
