/**
 * Login (brief G §3, G-3): a 401 is the one answer for a wrong credential,
 * and the session a login opens is the account's first restaurant.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createAuthApi } from "../../features/auth/api/auth-api.ts";
import { sessionFromLogin } from "../../features/auth/lib/session.ts";
import { createHttp } from "../../shared/api/http.ts";
import { memorySessionStore } from "../../shared/api/session-store.ts";

type Call = { url: string; headers: Record<string, string> };

test("login: a 401 is unauthorized, with no refresh and no token sent", async () => {
  const calls: Call[] = [];
  const fetch = (async (input: string, init: RequestInit = {}) => {
    calls.push({
      url: input,
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    return new Response(
      JSON.stringify({ message: "Unauthorized", statusCode: 401 }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof globalThis.fetch;
  const api = createAuthApi(
    createHttp({
      baseUrl: "http://api.test",
      store: memorySessionStore(),
      fetch,
    }),
  );

  assert.deepEqual(
    await api.login({ phoneOrEmail: "x@y.z", password: "nope" }),
    {
      ok: false,
      error: { kind: "unauthorized" },
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.headers["Authorization"], undefined);
});

test("sessionFromLogin: the first restaurant; none → no session", () => {
  const login = {
    accessToken: "a",
    refreshToken: "r",
    staff: { id: "s", name: "موظف", role: "staff" },
    restaurants: [
      { id: "r1", name: "الفرع الأول", branch: null, role: "staff" },
      { id: "r2", name: "الفرع الثاني", branch: null, role: "staff" },
    ],
  };
  assert.deepEqual(sessionFromLogin(login), {
    accessToken: "a",
    refreshToken: "r",
    restaurantId: "r1",
    restaurantName: "الفرع الأول",
  });
  assert.equal(sessionFromLogin({ ...login, restaurants: [] }), null);
});
