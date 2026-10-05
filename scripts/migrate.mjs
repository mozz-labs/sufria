/**
 * pnpm db:migrate — every file of db/migrations once, in numeric order, each
 * one recorded in the same transaction that applies it.
 *
 * The ledger, `migrations.applied`, is how a database says which files it
 * has run. It lives in a schema of its own, out of `public`: the schema-drift
 * check walks `public` alone, and the app roles get no grant on it (0003's
 * default privileges are for `public`).
 *
 * Three starting points:
 *   - an empty database: the ledger is created, then every file runs;
 *   - a database with the ledger: the files it does not list run, the rest
 *     are skipped — a second run does nothing;
 *   - a database built before the ledger existed (5 October 2026), the demo
 *     restaurant's among them: the files up to BASELINE are recorded as
 *     baselined, **only once the database proves BASELINE is there**, and
 *     the ones after it run. A database that cannot prove it stops before
 *     any file and before the ledger is created.
 *
 * Every file wraps itself in `BEGIN; … COMMIT;`, its first and last
 * statements, as every file since 0001 does. The runner puts its own
 * transaction in their place, so a file and its ledger row commit together
 * or not at all: a file that fails leaves no row and no trace.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

/** The last file every database built before the ledger had run. */
export const BASELINE = "0012_restaurants_with_unnotified_orders.sql";

/**
 * True when BASELINE's work is in the database: 0012 creates this function,
 * SECURITY DEFINER. Earlier files are not probed one by one — the files run
 * in order, each in its own transaction, so 0012 present means 0001–0011 ran.
 */
const BASELINE_PROBE = `
  SELECT COALESCE(
           (SELECT prosecdef FROM pg_proc
             WHERE oid = to_regprocedure('app.restaurants_with_unnotified_orders()')),
           false) AS proven`;

/**
 * An empty database: nothing any file creates — no `app` schema, and no
 * table, view, sequence or enum in `public`. Anything else is a database
 * some files already ran on.
 */
const EMPTY_PROBE = `
  SELECT NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'app')
     AND NOT EXISTS (SELECT 1 FROM pg_class c
                       JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname = 'public')
     AND NOT EXISTS (SELECT 1 FROM pg_type t
                       JOIN pg_namespace n ON n.oid = t.typnamespace
                      WHERE n.nspname = 'public' AND t.typtype = 'e')
    AS empty`;

const LEDGER_DDL = `
  CREATE SCHEMA IF NOT EXISTS migrations;
  CREATE TABLE IF NOT EXISTS migrations.applied (
    name       text        PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now(),
    -- true: recorded, not run here — the database had it before the ledger.
    baselined  boolean     NOT NULL DEFAULT false
  )`;

/** Two runs at once would both see the same file as new. This tool's own key. */
const LOCK_KEY = 8_604_104_013;

export class MigrationError extends Error {
  name = "MigrationError";
}

/**
 * The SQL a file runs inside the runner's transaction: the file with its
 * own `BEGIN;` and `COMMIT;` commented out, line numbers unchanged so an
 * error position still points at the file.
 *
 * 🔴 Refused when the two are not the first and last statements: SQL before
 *    `BEGIN;` or after `COMMIT;` would commit apart from its ledger row.
 */
function bodyOf(dir, name) {
  const lines = readFileSync(join(dir, name), "utf8").split("\n");
  const at = (re) => lines.flatMap((line, i) => (re.test(line) ? [i] : []));
  const begins = at(/^BEGIN;\s*$/);
  const commits = at(/^COMMIT;\s*$/);
  const outside = (i) =>
    i < begins[0] || i > commits[0] ? !/^\s*(--.*)?$/.test(lines[i]) : false;
  if (
    begins.length !== 1 ||
    commits.length !== 1 ||
    begins[0] > commits[0] ||
    lines.some((_, i) => outside(i))
  )
    throw new MigrationError(
      `${name}: كل migration بتلفّ حالها بـBEGIN; … COMMIT; وحدة، أول جملة وآخر جملة — ما اشتغل ولا ملف`,
    );
  lines[begins[0]] = "-- BEGIN; (the runner's transaction)";
  lines[commits[0]] =
    "-- COMMIT; (the runner's transaction, with the ledger row)";
  return lines.join("\n");
}

/** `:12` — the line of the file a Postgres error position points at. */
function lineOf(sql, error) {
  const position = Number(error?.position);
  return Number.isInteger(position) && position > 0
    ? `:${sql.slice(0, position - 1).split("\n").length}`
    : "";
}

async function transaction(client, work) {
  await client.query("BEGIN");
  try {
    await work();
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function one(client, sql) {
  return (await client.query(sql)).rows[0];
}

/**
 * @param {{ url: string, dir?: string, log?: (line: string) => void }} options
 * @returns {Promise<{ baselined: string[], applied: string[] }>}
 */
export async function migrate({ url, dir = "db/migrations", log = () => {} }) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (!files.length) throw new MigrationError(`لا يوجد migrations بـ${dir}`);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);

    const baselined = [];
    const { ledger } = await one(
      client,
      "SELECT to_regclass('migrations.applied') IS NOT NULL AS ledger",
    );
    if (!ledger) {
      const { empty } = await one(client, EMPTY_PROBE);
      if (!empty) {
        const { proven } = await one(client, BASELINE_PROBE);
        if (!proven)
          throw new MigrationError(
            `القاعدة فيها جداول وما فيها سجل هجرات (migrations.applied)، و${BASELINE} ` +
              "مش مطبّقة فيها (ما في app.restaurants_with_unnotified_orders()) — " +
              "ما بنعرف شو انطبق عليها. ما اشتغل ولا ملف وما تغيّر شي.",
          );
        if (!files.includes(BASELINE))
          throw new MigrationError(
            `${BASELINE} مش موجود بـ${dir} — ما اشتغل ولا ملف وما تغيّر شي.`,
          );
        baselined.push(...files.filter((f) => f <= BASELINE));
      }
      await transaction(client, async () => {
        await client.query(LEDGER_DDL);
        for (const name of baselined)
          await client.query(
            "INSERT INTO migrations.applied (name, baselined) VALUES ($1, true)",
            [name],
          );
      });
      if (baselined.length)
        log(
          `↺ قاعدة من قبل السجل: ${baselined.length} migration انعلّموا مطبّقين (لحد ${BASELINE})`,
        );
    }

    const done = new Set(
      (await client.query("SELECT name FROM migrations.applied")).rows.map(
        (row) => row.name,
      ),
    );
    // 🔴 The check that makes a second run do nothing. Every file it lets
    //    through is read and refused here before the first one runs.
    const pending = files
      .filter((name) => !done.has(name))
      .map((name) => ({ name, sql: bodyOf(dir, name) }));

    const applied = [];
    for (const { name, sql } of pending) {
      try {
        await transaction(client, async () => {
          await client.query(sql);
          await client.query(
            "INSERT INTO migrations.applied (name) VALUES ($1)",
            [name],
          );
        });
      } catch (error) {
        // The message and the line, not `detail`: Postgres puts the failing
        // row there, and a row of this database carries customers' phones.
        throw new MigrationError(
          `${name}${lineOf(sql, error)}: ${error.message} — هالملف ما ترك ولا أثر`,
          { cause: error },
        );
      }
      applied.push(name);
      log(`→ ${name}`);
    }
    return { baselined, applied };
  } finally {
    // The advisory lock is the session's: it goes with the connection.
    await client.end().catch(() => {});
  }
}

// `pnpm db:migrate`: the repo's migrations, as the migration role.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "لا يوجد MIGRATION_DATABASE_URL. انسخ .env.example لـ .env أولا.",
    );
    process.exit(1);
  }
  migrate({ url, log: (line) => console.log(line) }).then(
    ({ applied }) => {
      console.log(
        applied.length
          ? `✓ ${applied.length} migration جديدة اشتغلت`
          : "✓ ولا migration جديدة — القاعدة محدّثة",
      );
    },
    (error) => {
      console.error(`✗ ${error.message}`);
      process.exit(1);
    },
  );
}
