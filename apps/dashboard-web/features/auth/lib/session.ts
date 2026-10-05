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
