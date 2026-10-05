/**
 * The session a login opens (brief G §3, G-3). The store that keeps it is the
 * client's, in `shared/api/session-store.ts`.
 */
import type { LoginResult } from "@sufria/shared";
import type { Session } from "../../../shared/api/session-store.ts";

/**
 * The session a login opens: the **first** restaurant of the account.
 * The pilot is one restaurant; an account in two branches gets the first
 * (G-3, recorded as a decision). `null` for an account with none.
 */
export function sessionFromLogin(result: LoginResult): Session | null {
  const restaurant = result.restaurants[0];
  if (!restaurant) return null;
  return {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
  };
}

/** Where a login goes when `?next=` names nowhere usable (brief I §2.1). */
export const AFTER_LOGIN = "/orders";

/**
 * `?next=` on /login: a path of this site, or /orders. A path starts with one
 * `/` — `//evil.com` is another host — and holds no backslash, whitespace or
 * control character: a browser reads `/\evil.com` and `/<tab>/evil.com` as
 * `//evil.com` too. `https://…` does not start with `/`. /login itself would
 * leave a logged-in screen on the login form.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//"))
    return AFTER_LOGIN;
  if (/[\\\s\u0000-\u001f\u007f]/.test(next)) return AFTER_LOGIN;
  if (next === "/login" || next.startsWith("/login?")) return AFTER_LOGIN;
  return next;
}

/** The login screen, coming back to `path` after it. */
export function loginPathFor(path: string): string {
  return `/login?next=${encodeURIComponent(path)}`;
}
