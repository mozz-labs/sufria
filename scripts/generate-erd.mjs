/**
 * يولّد مخطط ERD من قاعدة البيانات الفعلية، مش من تصميم على ورق.
 *
 * ليش هيك: أي ERD مرسوم بالإيد بيصير قديم أول migration. هذا بيتولّد من
 * information_schema، فمستحيل يناقض الواقع. شغّله بعد أي تعديل schema.
 *
 *   node scripts/generate-erd.mjs > docs/diagrams/erd.mmd
 */
import { Client } from "pg";

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("لا يوجد DATABASE_URL");
  process.exit(1);
}

const db = new Client({ connectionString: url });
await db.connect();

const { rows: cols } = await db.query(`
  SELECT c.table_name, c.column_name, c.ordinal_position,
         CASE
           WHEN c.data_type = 'USER-DEFINED'            THEN c.udt_name
           WHEN c.data_type = 'character varying'       THEN 'varchar'
           WHEN c.data_type = 'timestamp with time zone' THEN 'timestamptz'
           WHEN c.data_type = 'character'               THEN 'char'
           WHEN c.data_type = 'double precision'        THEN 'float8'
           ELSE replace(c.data_type, ' ', '_')
         END AS type,
         c.is_nullable
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_name = c.table_name AND t.table_schema = c.table_schema
  WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
  ORDER BY c.table_name, c.ordinal_position`);

const { rows: pks } = await db.query(`
  SELECT tc.table_name, kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
  WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'`);

const { rows: uqs } = await db.query(`
  SELECT tc.table_name, kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
  WHERE tc.table_schema = 'public' AND tc.constraint_type = 'UNIQUE'`);

// العلاقات: مصدرها pg_constraint عشان نمسك الـcomposite FKs كمان
const { rows: fks } = await db.query(`
  SELECT con.conname,
         src.relname  AS src_table,
         tgt.relname  AS tgt_table,
         (SELECT string_agg(a.attname, ',' ORDER BY x.ord)
            FROM unnest(con.conkey) WITH ORDINALITY AS x(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = x.attnum) AS src_cols,
         con.confdeltype AS on_delete
  FROM pg_constraint con
  JOIN pg_class src ON src.oid = con.conrelid
  JOIN pg_class tgt ON tgt.oid = con.confrelid
  JOIN pg_namespace n ON n.oid = src.relnamespace
  WHERE con.contype = 'f' AND n.nspname = 'public'
  ORDER BY src.relname, con.conname`);

const { rows: rls } = await db.query(`
  SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'`);

const pk = new Set(pks.map((r) => `${r.table_name}.${r.column_name}`));
const uq = new Set(uqs.map((r) => `${r.table_name}.${r.column_name}`));
const rlsOn = new Map(rls.map((r) => [r.tablename, r.rowsecurity]));

const byTable = new Map();
for (const c of cols) {
  if (!byTable.has(c.table_name)) byTable.set(c.table_name, []);
  byTable.get(c.table_name).push(c);
}

const out = ["erDiagram"];
for (const [t, list] of [...byTable].sort()) {
  out.push(`  ${t} {`);
  for (const c of list) {
    const keys = [];
    if (pk.has(`${t}.${c.column_name}`)) keys.push("PK");
    if (
      fks.some(
        (f) =>
          f.src_table === t && f.src_cols.split(",").includes(c.column_name),
      )
    )
      keys.push("FK");
    if (uq.has(`${t}.${c.column_name}`) && !keys.includes("PK"))
      keys.push("UK");
    const note = c.is_nullable === "YES" ? '"nullable"' : "";
    out.push(
      `    ${c.type} ${c.column_name}${keys.length ? " " + keys.join(",") : ""}${note ? " " + note : ""}`,
    );
  }
  out.push("  }");
}

// لما يكون في FK بسيط و FK مركّب بين نفس الجدولين، نعرض المركّب:
// هو اللي بيحمل ضمانة العزل — صف يتيم بـrestaurant_id غلط مستحيل يُكتب.
const best = new Map();
for (const f of fks) {
  const key = `${f.src_table}->${f.tgt_table}`;
  const prev = best.get(key);
  if (!prev || (f.src_cols.includes(",") && !prev.src_cols.includes(",")))
    best.set(key, f);
}
for (const f of best.values()) {
  const label = f.src_cols.includes(",")
    ? `${f.src_cols} · tenant-safe`
    : f.src_cols;
  out.push(`  ${f.tgt_table} ||--o{ ${f.src_table} : "${label}"`);
}

console.log(out.join("\n"));
console.error(
  `\n// ${byTable.size} جدول · ${fks.length} علاقة · RLS على ${[...rlsOn.values()].filter(Boolean).length}`,
);
console.error(
  `// بلا RLS بقرار موثّق: ${[...rlsOn]
    .filter(([, v]) => !v)
    .map(([k]) => k)
    .join(", ")}`,
);

await db.end();
