import { useSyncExternalStore } from "react";
import { sessionStore } from "../../../shared/api/client.ts";
import type { Session } from "../../../shared/api/session-store.ts";

const subscribe = () => () => {};

/**
 * The session as the page renders it: `undefined` while the server renders
 * (it has no `sessionStorage`), then the stored session or `null`.
 */
export function useSession(): Session | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => sessionStore.get(),
    () => undefined,
  );
}
