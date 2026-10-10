/**
 * The dashboard's one HTTP client (brief G §3, G-2): `fetch`, the token, the
 * restaurant header, and the API's errors turned into a small closed set the
 * screens can switch on. Each feature builds its own calls on top of it
 * (`features/<x>/api/`); the shapes are the API's own, from `@sufria/shared`.
 *
 * Every call resolves — to `{ ok: true, value }` or `{ ok: false, error }` —
 * so a screen never has an unhandled rejection to forget.
 */
import type {
  MenuConflictBody,
  OrderStatus,
  OrderStatusConflictBody,
  RefreshResult,
} from "@sufria/shared";
import type { SessionStore } from "./session-store.ts";

export type ApiError =
  /** 401 that a refresh could not cure — the screen goes back to login. */
  | { kind: "unauthorized" }
  /** 409 `status_conflict`: the order moved on another device. */
  | { kind: "status_conflict"; currentStatus: OrderStatus }
  /** Any other 409 (`payment_not_settled`, `transition_not_allowed`). */
  | {
      kind: "conflict";
      code: Exclude<OrderStatusConflictBody["code"], "status_conflict">;
    }
  /**
   * A 409 of the menu routes (brief ي-أ §5): the first message would be
   * `length` characters, over `limit` — or the item is archived.
   */
  | {
      kind: "menu_conflict";
      code: "menu_too_long";
      length: number;
      limit: number;
    }
  | { kind: "menu_conflict"; code: "item_archived" }
  /** No answer at all: the API is down or the connection dropped. */
  | { kind: "network" }
  /** An answer that is none of the above (400, 403, 404, 5xx). */
  | { kind: "http"; status: number };

export type ApiResult<T> =
  { ok: true; value: T } | { ok: false; error: ApiError };

/**
 * What a request carries: nothing, the token, or the token and the
 * restaurant (`x-restaurant-id`).
 */
export type AuthMode = "none" | "token" | "restaurant";

export type CallInit = {
  method: string;
  body?: unknown;
  auth: AuthMode;
};

export type Http = {
  /** One request, its 401 refreshed once, its answer turned into a result. */
  call<T>(path: string, init: CallInit): Promise<ApiResult<T>>;
  /** The raw request: no refresh, no error mapping. `null` without a session. */
  send(path: string, init: CallInit): Promise<Response | null>;
  /** The session the requests read their token and restaurant from. */
  store: SessionStore;
};

export type HttpOptions = {
  baseUrl: string;
  store: SessionStore;
  fetch?: typeof fetch;
};

export function createHttp({
  baseUrl,
  store,
  fetch: doFetch = fetch,
}: HttpOptions): Http {
  const url = (path: string) => `${baseUrl.replace(/\/+$/, "")}${path}`;

  async function send(path: string, init: CallInit): Promise<Response | null> {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    const session = store.get();
    if (init.auth !== "none") {
      if (!session) return null;
      headers["Authorization"] = `Bearer ${session.accessToken}`;
      if (init.auth === "restaurant")
        headers["x-restaurant-id"] = session.restaurantId;
    }
    return doFetch(url(path), {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  }

  /** One refresh per 401; `false` means the session is over. */
  async function refresh(): Promise<boolean> {
    const session = store.get();
    if (!session) return false;
    try {
      const res = await doFetch(url("/auth/refresh"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      if (!res.ok) return false;
      const { accessToken } = (await res.json()) as RefreshResult;
      store.set({ ...session, accessToken });
      return true;
    } catch {
      return false;
    }
  }

  async function call<T>(path: string, init: CallInit): Promise<ApiResult<T>> {
    try {
      let res = await send(path, init);
      if (
        res &&
        res.status === 401 &&
        init.auth !== "none" &&
        (await refresh())
      )
        res = await send(path, init);
      if (!res || res.status === 401) {
        if (init.auth !== "none") store.clear();
        return { ok: false, error: { kind: "unauthorized" } };
      }
      if (res.ok) return { ok: true, value: (await res.json()) as T };
      if (res.status === 409)
        return { ok: false, error: await conflictOf(res) };
      return { ok: false, error: { kind: "http", status: res.status } };
    } catch {
      return { ok: false, error: { kind: "network" } };
    }
  }

  return { call, send, store };
}

async function conflictOf(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as
      OrderStatusConflictBody | MenuConflictBody;
    if (body.code === "status_conflict")
      return { kind: "status_conflict", currentStatus: body.currentStatus };
    if (
      body.code === "payment_not_settled" ||
      body.code === "transition_not_allowed"
    )
      return { kind: "conflict", code: body.code };
    if (body.code === "menu_too_long" && typeof body.length === "number")
      return {
        kind: "menu_conflict",
        code: body.code,
        length: body.length,
        limit: body.limit,
      };
    if (body.code === "item_archived")
      return { kind: "menu_conflict", code: body.code };
  } catch {
    // Not a §9.3 or §9.10 body: fall through to a plain HTTP error.
  }
  return { kind: "http", status: 409 };
}
