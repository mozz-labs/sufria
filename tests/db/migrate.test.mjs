/**
 * `pnpm db:migrate` (scripts/migrate.mjs): each file once, recorded in the
 * transaction that applies it, and a database built before the ledger
 * recorded up to 0012 only when it proves 0012.
 *
 * Every test runs on a database of its own, created here and dropped after
 * it — never on the database in `.env`. Needs a role that can CREATE
 * DATABASE: MIGRATION_DATABASE_URL, the role that runs migrations anyway.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { BASELINE, MigrationError, migrate } from "../../scripts/migrate.mjs";

const ADMIN_URL = process.env.MIGRATION_DATABASE_URL;
const MIGRATIONS = "db/migrations";
const FILES = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort();

async function query(url, sql, params) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows;
  } finally {
    await client.end();
  }
}

let databases = 0;

/** A new, empty database for this test alone, dropped when it ends. */
async function database(t) {
  assert.ok(ADMIN_URL, "MIGRATION_DATABASE_URL is not set");
  const name = `sufria_migrate_test_${process.pid}_${++databases}`;
  await query(ADMIN_URL, `CREATE DATABASE ${name} TEMPLATE template0`);
  t.after(() =>
    query(ADMIN_URL, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`),
  );
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

/** The repo's migrations plus `extra` files, in a directory of the test's own. */
function dirWith(t, extra) {
  const dir = mkdtempSync(join(tmpdir(), "sufria-migrations-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const f of FILES) copyFileSync(join(MIGRATIONS, f), join(dir, f));
  for (const [name, sql] of Object.entries(extra))
    writeFileSync(join(dir, name), sql);
  return dir;
}

/**
 * What the tool did before the ledger: each file as written, its own
 * `BEGIN; … COMMIT;` included, up to `last`.
 */
async function migrateTheOldWay(url, last) {
  for (const f of FILES.filter((name) => name <= last))
    await query(url, readFileSync(join(MIGRATIONS, f), "utf8"));
}

const ledger = (url) =>
  query(url, "SELECT name, baselined FROM migrations.applied ORDER BY name");

const exists = async (url, relation) =>
  (await query(url, "SELECT to_regclass($1) IS NOT NULL AS ok", [relation]))[0]
    .ok;

const publicTables = async (url) =>
  (
    await query(
      url,
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' ORDER BY table_name`,
    )
  ).map((r) => r.table_name);

test("an empty database: every file runs, each with its ledger row", async (t) => {
  const url = await database(t);

  assert.deepEqual(await migrate({ url }), { baselined: [], applied: FILES });
  assert.deepEqual(
    await ledger(url),
    FILES.map((name) => ({ name, baselined: false })),
  );
  assert.equal(await exists(url, "public.restaurants"), true);
});

test("🔴 a second run runs nothing and records nothing", async (t) => {
  const url = await database(t);
  await migrate({ url });
  const before = await query(
    url,
    "SELECT name, applied_at, baselined FROM migrations.applied ORDER BY name",
  );

  assert.deepEqual(await migrate({ url }), { baselined: [], applied: [] });
  assert.deepEqual(
    await query(
      url,
      "SELECT name, applied_at, baselined FROM migrations.applied ORDER BY name",
    ),
    before,
  );
});

test("a database from before the ledger: recorded up to 0012, only what follows runs, its rows untouched", async (t) => {
  const url = await database(t);
  await migrateTheOldWay(url, BASELINE);
  const [{ id }] = await query(
    url,
    "INSERT INTO restaurants (name) VALUES ('مطعم قديم') RETURNING id",
  );
  const dir = dirWith(t, {
    "9999_after_baseline.sql":
      "BEGIN;\nCREATE TABLE after_baseline_marker (id int);\nCOMMIT;\n",
  });

  const result = await migrate({ url, dir });

  const upTo = FILES.filter((f) => f <= BASELINE);
  const after = [
    ...FILES.filter((f) => f > BASELINE),
    "9999_after_baseline.sql",
  ];
  assert.equal(upTo.length, 12);
  assert.deepEqual(result, { baselined: upTo, applied: after });
  assert.deepEqual(await ledger(url), [
    ...upTo.map((name) => ({ name, baselined: true })),
    ...after.map((name) => ({ name, baselined: false })),
  ]);
  assert.equal(await exists(url, "public.after_baseline_marker"), true);
  assert.deepEqual(
    await query(url, "SELECT name FROM restaurants WHERE id = $1", [id]),
    [{ name: "مطعم قديم" }],
  );
});

test("🔴 a database from before the ledger without 0012: stops before any file, ledger not created", async (t) => {
  const url = await database(t);
  await migrateTheOldWay(url, "0005_restaurants_for_staff.sql");

  await assert.rejects(
    migrate({ url }),
    (error) =>
      error instanceof MigrationError &&
      error.message.includes(BASELINE) &&
      error.message.includes("ما اشتغل ولا ملف"),
  );
  assert.equal(await exists(url, "migrations.applied"), false);
  // 0006 is the first file it would have run.
  assert.equal(await exists(url, "public.inbound_messages"), false);
});

test("🔴 a file that fails leaves no ledger row and the database as it was", async (t) => {
  const url = await database(t);
  await migrate({ url });
  const tables = await publicTables(url);
  const recorded = await ledger(url);
  const dir = dirWith(t, {
    "9999_broken.sql":
      "BEGIN;\nCREATE TABLE broken_marker (id int);\nINSERT INTO no_such_table VALUES (1);\nCOMMIT;\n",
  });

  await assert.rejects(
    migrate({ url, dir }),
    (error) =>
      error instanceof MigrationError &&
      error.message.startsWith(
        '9999_broken.sql:3: relation "no_such_table" does not exist',
      ),
  );
  assert.deepEqual(await publicTables(url), tables);
  assert.deepEqual(await ledger(url), recorded);
});

test("a file with SQL outside its BEGIN … COMMIT is refused before any file runs", async (t) => {
  const url = await database(t);
  const dir = dirWith(t, {
    "9999_outside.sql":
      "CREATE TABLE outside_marker (id int);\nBEGIN;\nSELECT 1;\nCOMMIT;\n",
  });

  await assert.rejects(
    migrate({ url, dir }),
    (error) =>
      error instanceof MigrationError &&
      error.message.startsWith("9999_outside.sql:"),
  );
  assert.deepEqual(await publicTables(url), []);
  assert.deepEqual(await ledger(url), []);
});
