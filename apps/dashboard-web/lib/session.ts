/**
 * The logged-in session: the two tokens and the restaurant the screen works
 * in (brief G §3, G-3).
 *
 * Kept in `sessionStorage` — the simplest store the API allows: it survives a
 * reload, dies with the tab, and never travels to the server by itself (the
 * token goes in `Authorization`, not a cookie). Not `localStorage`: a closed
 * tab at the counter should not leave a logged-in dashboard behind.
 */
import type { LoginResult } from "@sufria/shared";

export type Session = {
  accessToken: string;
  refreshToken: string;
  /** The value of `x-restaurant-id`. */
  restaurantId: string;
  /** The page title (G-4). */
  restaurantName: string;
};

export type SessionStore = {
  get(): Session | null;
  set(session: Session): void;
  clear(): void;
};

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

const KEY = "sufria.session";

function isSession(v: unknown): v is Session {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s["accessToken"] === "string" &&
    typeof s["refreshToken"] === "string" &&
    typeof s["restaurantId"] === "string" &&
    typeof s["restaurantName"] === "string"
  );
}

/** `sessionStorage`, and nothing at all where it is unavailable. */
export function browserSessionStore(): SessionStore {
  const storage = (): Storage | null => {
    try {
      return typeof window === "undefined" ? null : window.sessionStorage;
    } catch {
      return null;
    }
  };
  return {
    get() {
      try {
        const raw = storage()?.getItem(KEY);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return isSession(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    set(session) {
      try {
        storage()?.setItem(KEY, JSON.stringify(session));
      } catch {
        // A browser that refuses storage keeps the session for this page only.
      }
    },
    clear() {
      try {
        storage()?.removeItem(KEY);
      } catch {
        // Nothing stored, nothing to clear.
      }
    },
  };
}

/** For tests: the same contract, in memory. */
export function memorySessionStore(
  initial: Session | null = null,
): SessionStore {
  let current = initial;
  return {
    get: () => current,
    set: (s) => {
      current = s;
    },
    clear: () => {
      current = null;
    },
  };
}
