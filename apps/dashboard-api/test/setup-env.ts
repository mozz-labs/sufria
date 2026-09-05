/**
 * Runs before the test framework, so anything imported by a spec already sees a
 * populated process.env.
 *
 * config/env.ts reads process.env once and caches it, and auth.module.ts calls
 * env() at module-evaluation time (JwtModule.register({ secret: env().JWT_SECRET })).
 * If the variables are not in place before the first import of a Nest module,
 * the suite fails at import with "إعدادات البيئة غير صالحة" rather than at a
 * point that tells you anything.
 */
import "reflect-metadata";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Real environment wins. CI exports DATABASE_URL directly and has no .env file.
function loadDotEnv(path: string): void {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv(resolve(__dirname, "../../../.env"));

process.env["NODE_ENV"] = "test";

/**
 * CI has no .env — it exports DATABASE_URL directly and nothing else. env()
 * requires a JWT_SECRET of at least 16 characters and throws at import time
 * without one, so the suite would fail there and only there.
 *
 * This key signs tokens that exist for the length of one test run and are
 * verified by the same process. It is never a production path: NODE_ENV is
 * "test" above, and a real deployment reads JWT_SECRET from its own environment,
 * which takes precedence over this line.
 */
process.env["JWT_SECRET"] ??= "test-only-jwt-secret-not-used-anywhere-else";

// 🔴 One connection, so "did the context leak onto the pooled connection?" is a
// deterministic question. With a larger pool the follow-up query may land on a
// different member and the leak test would pass without proving anything.
process.env["PG_POOL_MAX"] = "1";
