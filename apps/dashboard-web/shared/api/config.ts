/**
 * The API's address, from `NEXT_PUBLIC_API_URL` (`.env.example`). Next
 * inlines `NEXT_PUBLIC_*` into the browser bundle when `next dev` starts; the
 * default is the API's development port (`DASHBOARD_API_PORT` 3002).
 */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3002";
