import { sql, type SQL } from "drizzle-orm";

/**
 * timestamptz → ISO 8601 in UTC, in SQL: the drizzle driver returns a
 * timestamptz from `execute` as raw text, not as a `Date`. NULL stays NULL.
 *
 * `column` is SQL text, never a value: a column name written in the code.
 */
export const isoUtc = (column: string): SQL =>
  sql.raw(
    `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  );
