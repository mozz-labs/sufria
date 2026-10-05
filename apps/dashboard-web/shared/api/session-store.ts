/**
 * The logged-in session: the two tokens and the restaurant the screen works
 * in (brief G §3, G-3) — what every request reads its `Authorization` and
 * `x-restaurant-id` from. `features/auth/lib/session.ts` makes one from a
 * login.
 *
 * Kept in `sessionStorage` — the simplest store the API allows: it survives a
 * reload, dies with the tab, and never travels to the server by itself (the
 * token goes in `Authorization`, not a cookie). Not `localStorage`: a closed
 * tab at the counter should not leave a logged-in dashboard behind.
 */

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
  /**
   * Called after every `set` and `clear` — what lets a 401 that ends the
   * session (the client clears it) reach the guard on any page. Returns the
   * unsubscribe.
   */
  subscribe(listener: () => void): () => void;
};

/** The listeners of one store, and the call that tells them all. */
function listeners() {
  const all = new Set<() => void>();
  return {
    notify: () => all.forEach((listener) => listener()),
    subscribe: (listener: () => void) => {
      all.add(listener);
      return () => {
        all.delete(listener);
      };
    },
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
  // The same object for the same stored text, so that React's
  // useSyncExternalStore sees a stable snapshot between two reads.
  let lastRaw: string | null = null;
  let last: Session | null = null;
  const { notify, subscribe } = listeners();
  return {
    subscribe,
    get() {
      try {
        const raw = storage()?.getItem(KEY) ?? null;
        if (raw === lastRaw) return last;
        lastRaw = raw;
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        last = isSession(parsed) ? parsed : null;
        return last;
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
      notify();
    },
    clear() {
      try {
        storage()?.removeItem(KEY);
      } catch {
        // Nothing stored, nothing to clear.
      }
      notify();
    },
  };
}

/** For tests: the same contract, in memory. */
export function memorySessionStore(
  initial: Session | null = null,
): SessionStore {
  let current = initial;
  const { notify, subscribe } = listeners();
  return {
    get: () => current,
    set: (s) => {
      current = s;
      notify();
    },
    clear: () => {
      current = null;
      notify();
    },
    subscribe,
  };
}
