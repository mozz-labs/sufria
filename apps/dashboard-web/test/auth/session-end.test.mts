/**
 * 401 → /login (brief ي-ب §2): a request whose 401 the refresh cannot cure
 * ends the session on any page — the browser's store forgets it and tells
 * its listeners, and the session gate, one of them, sends the page to
 * `/login?next=<the page>`. The menu's calls go through the same client.
 *
 * The gate is TSX, which `node --test` cannot import: its two lines are held
 * by reading them, as the card's link is (test/orders/card.test.mts).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loginPathFor, safeNext } from "../../features/auth/lib/session.ts";
import { createHttp } from "../../shared/api/http.ts";
import {
  browserSessionStore,
  type Session,
} from "../../shared/api/session-store.ts";

const SESSION: Session = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  restaurantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  restaurantName: "مطعم",
};

const read = (path: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../${path}`, import.meta.url)),
    "utf8",
  );

/** A tab's `sessionStorage`, for the store the dashboard really uses. */
function withBrowserStorage<T>(run: () => Promise<T>): Promise<T> {
  const kept = new Map<string, string>();
  const g = globalThis as { window?: unknown };
  g.window = {
    sessionStorage: {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => void kept.set(k, String(v)),
      removeItem: (k: string) => void kept.delete(k),
    },
  };
  return run().finally(() => {
    delete g.window;
  });
}

test("🔴 a 401 the refresh cannot cure: the browser's store forgets the session and tells its listeners", () =>
  withBrowserStorage(async () => {
    const store = browserSessionStore();
    store.set(SESSION);
    assert.deepEqual(store.get(), SESSION);
    let heard = 0;
    store.subscribe(() => heard++);
    const answers = [401, 401];
    const http = createHttp({
      baseUrl: "http://api.test",
      store,
      fetch: (async () =>
        new Response(JSON.stringify({ statusCode: answers[0] }), {
          status: answers.shift()!,
          headers: { "Content-Type": "application/json" },
        })) as typeof fetch,
    });

    const res = await http.call("/menu-items", {
      method: "GET",
      auth: "restaurant",
    });

    assert.deepEqual(res, { ok: false, error: { kind: "unauthorized" } });
    assert.equal(answers.length, 0, "the request, then one refresh");
    assert.equal(store.get(), null);
    assert.equal(heard, 1, "the store's listeners — the gate — were told");
  }));

test("🔴 the gate, told the session is gone, sends the page to /login?next=<the page>", () => {
  // The gate renders from the store, again whenever it changes.
  assert.match(
    read("features/auth/hooks/use-session.ts"),
    /useSyncExternalStore\(\s*sessionStore\.subscribe,/,
  );
  const gate = read("features/auth/components/session-gate.tsx");
  assert.match(gate, /const session = useSession\(\);/);
  // No session, and not leaving by «خروج»: the login screen, back here after.
  assert.match(
    gate,
    /if \(session !== null \|\| leaving\) return;\s*router\.replace\(\s*loginPathFor\(window\.location\.pathname \+ window\.location\.search\),?\s*\);/,
  );
  // The path it builds, read back the way the login form reads it.
  for (const page of ["/menu", "/menu/removed", "/orders/x?from=history"]) {
    const next = new URL(
      `http://dash.test${loginPathFor(page)}`,
    ).searchParams.get("next");
    assert.equal(safeNext(next), page);
  }
});
