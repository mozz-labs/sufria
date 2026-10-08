/**
 * Login and logout, on the shared client (`shared/api/http.ts`). The shapes
 * are the API's own, from `@sufria/shared` (brief D §9.8).
 */
import type { LoginRequest, LoginResult } from "@sufria/shared";
import { http as browserHttp } from "../../../shared/api/client.ts";
import type { ApiResult, Http } from "../../../shared/api/http.ts";

export type AuthApi = {
  login(request: LoginRequest): Promise<ApiResult<LoginResult>>;
  /** Revokes the refresh token when it can, and forgets the session always. */
  logout(): Promise<void>;
};

export function createAuthApi(http: Http): AuthApi {
  return {
    login: (request) =>
      http.call<LoginResult>("/auth/login", {
        method: "POST",
        body: request,
        auth: "none",
      }),
    logout: async () => {
      try {
        await http.send("/auth/logout", { method: "POST", auth: "token" });
      } catch {
        // Logging out works offline too: the session is forgotten below.
      }
      http.store.clear();
    },
  };
}

/** The browser's auth calls. Tests build their own with `createAuthApi`. */
export const authApi = createAuthApi(browserHttp);
