// Asserts the Drizzle schema mirror matches the SQL migrations exactly.
// Run this in CI: schema.ts drifting from db/migrations/ is a silent runtime bug.
import { Pool } from "pg";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../../packages/shared/src/schema.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows } = await pool.query<{
    table_name: string;
    column_name: string;
  }>(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema='public' ORDER BY table_name, column_name`,
  );
  const dbCols = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!dbCols.has(r.table_name)) dbCols.set(r.table_name, new Set());
    dbCols.get(r.table_name)!.add(r.column_name);
  }

  let problems = 0;
  const mirrored = new Set<string>();
  for (const [key, val] of Object.entries(schema)) {
    if (!(val instanceof PgTable)) continue;
    const cfg = getTableConfig(val as PgTable);
    mirrored.add(cfg.name);
    const actual = dbCols.get(cfg.name);
    if (!actual) {
      console.log(`  ✗ table "${cfg.name}" (${key}) is not in the database`);
      problems++;
      continue;
    }
    const declared = new Set(cfg.columns.map((c) => c.name));
    const missing = [...declared].filter((c) => !actual.has(c));
    const extra = [...actual].filter((c) => !declared.has(c));
    if (missing.length) {
      console.log(
        `  ✗ ${cfg.name}: declared in TS but absent in SQL -> ${missing.join(", ")}`,
      );
      problems++;
    }
    if (extra.length) {
      console.log(
        `  ! ${cfg.name}: in SQL but not mirrored in TS -> ${extra.join(", ")}`,
      );
      problems++;
    }
    if (!missing.length && !extra.length)
      console.log(`  ✓ ${cfg.name} (${declared.size} cols)`);
  }

  // A table this loop never visits is a table this check never checked. Until
  // inbound_messages moved into packages/shared its mirror lived in
  // apps/conversation-engine, so every column of it could drift in silence and
  // the run above still printed "schema mirror matches the migrations".
  // Iterating the TS side alone cannot notice that: the absence of a mirror is
  // invisible from the mirrors. So walk the database's own table list too.
  for (const table of [...dbCols.keys()].sort()) {
    if (mirrored.has(table)) continue;
    console.log(
      `  ✗ table "${table}" exists in SQL but is mirrored nowhere in packages/shared — drift for it is undetectable`,
    );
    problems++;
  }

  console.log(
    problems === 0
      ? "\nschema mirror matches the migrations"
      : `\n${problems} drift issue(s)`,
  );
  await pool.end();
  process.exit(problems === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
