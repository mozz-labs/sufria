import { useSyncExternalStore } from "react";
import { sessionStore } from "../../../shared/api/client.ts";
import type { Session } from "../../../shared/api/session-store.ts";

/**
 * The session as the page renders it: `undefined` while the server renders
 * (it has no `sessionStorage`), then the stored session or `null` — again
 * whenever it changes, a 401 that ended it included.
 */
export function useSession(): Session | null | undefined {
  return useSyncExternalStore(
    sessionStore.subscribe,
    () => sessionStore.get(),
    () => undefined,
  );
}
