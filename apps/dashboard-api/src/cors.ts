import type { INestApplication } from "@nestjs/common";

type CorsOptions = NonNullable<Parameters<INestApplication["enableCors"]>[0]>;

/** The dashboard's origin in development — `DASHBOARD_WEB_PORT` 3000. */
export const DEFAULT_DASHBOARD_WEB_ORIGIN = "http://localhost:3000";

/**
 * CORS for the dashboard (brief G §3, G-2): the dashboard's origin from
 * `DASHBOARD_WEB_ORIGIN` (comma-separated for more than one), the local
 * development origin by default.
 *
 * 🔴 An array, not a string: with a string the `cors` package sends that
 *    origin back to *every* caller, and it is the browser alone that refuses.
 *    With an array it answers a foreign origin with no
 *    `Access-Control-Allow-Origin` at all.
 *
 * The token travels in the `Authorization` header, not a cookie;
 * `credentials: true` is kept as it was before G.
 */
export function corsOptions(
  raw: string | undefined = process.env["DASHBOARD_WEB_ORIGIN"],
): CorsOptions {
  const origins = (raw ?? DEFAULT_DASHBOARD_WEB_ORIGIN)
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  return {
    origin: origins.length > 0 ? origins : [DEFAULT_DASHBOARD_WEB_ORIGIN],
    credentials: true,
  };
}
