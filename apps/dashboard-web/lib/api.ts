/**
 * The dashboard's one API client (brief G §3, G-2): `fetch`, the token, the
 * restaurant header, and the API's errors turned into a small closed set the
 * screen can switch on. The shapes are the API's own, from `@sufria/shared`.
 *
 * Every call resolves — to `{ ok: true, value }` or `{ ok: false, error }` —
 * so a screen never has an unhandled rejection to forget.
 */
import type {
  LoginRequest,
  LoginResult,
  OrderListItem,
  OrderListResponse,
  OrderStatus,
  OrderStatusConflictBody,
  OrderTab,
  RefreshResult,
  RestaurantSettings,
  StaffTargetStatus,
  UpdateOrderStatusRequest,
  UpdateOrderStatusResponse,
} from "@sufria/shared";
import type { SessionStore } from "./session.ts";

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
  /** No answer at all: the API is down or the connection dropped. */
  | { kind: "network" }
  /** An answer that is none of the above (400, 403, 404, 5xx). */
  | { kind: "http"; status: number };

export type ApiResult<T> =
  { ok: true; value: T } | { ok: false; error: ApiError };

export type Api = {
  login(request: LoginRequest): Promise<ApiResult<LoginResult>>;
  listOrders(
    tab: OrderTab,
    page?: number,
  ): Promise<ApiResult<OrderListResponse>>;
  /**
   * 🔴 `from` is the status the card **showed** (brief D §2.7), taken from
   *    the order the card holds — never re-read before sending.
   */
  changeStatus(
    shown: Pick<OrderListItem, "id" | "status">,
    to: StaffTargetStatus,
  ): Promise<ApiResult<UpdateOrderStatusResponse>>;
  restaurantSettings(): Promise<ApiResult<RestaurantSettings>>;
  /** Revokes the refresh token when it can, and forgets the session always. */
  logout(): Promise<void>;
};

export type ApiOptions = {
  baseUrl: string;
  store: SessionStore;
  fetch?: typeof fetch;
};

export function createApi({
  baseUrl,
  store,
  fetch: doFetch = fetch,
}: ApiOptions): Api {
  const url = (path: string) => `${baseUrl.replace(/\/+$/, "")}${path}`;

  async function send(
    path: string,
    init: {
      method: string;
      body?: unknown;
      auth: "none" | "token" | "restaurant";
    },
  ): Promise<Response | null> {
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

  async function call<T>(
    path: string,
    init: {
      method: string;
      body?: unknown;
      auth: "none" | "token" | "restaurant";
    },
  ): Promise<ApiResult<T>> {
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

  return {
    login: (request) =>
      call<LoginResult>("/auth/login", {
        method: "POST",
        body: request,
        auth: "none",
      }),
    listOrders: (tab, page = 1) =>
      call<OrderListResponse>(
        `/orders?tab=${tab}${tab === "history" ? `&page=${page}` : ""}`,
        { method: "GET", auth: "restaurant" },
      ),
    changeStatus: (shown, to) => {
      const body: UpdateOrderStatusRequest = { from: shown.status, to };
      return call<UpdateOrderStatusResponse>(
        `/orders/${encodeURIComponent(shown.id)}/status`,
        { method: "PATCH", body, auth: "restaurant" },
      );
    },
    restaurantSettings: () =>
      call<RestaurantSettings>("/restaurant/settings", {
        method: "GET",
        auth: "restaurant",
      }),
    logout: async () => {
      try {
        await send("/auth/logout", { method: "POST", auth: "token" });
      } catch {
        // Logging out works offline too: the session is forgotten below.
      }
      store.clear();
    },
  };
}

async function conflictOf(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as OrderStatusConflictBody;
    if (body.code === "status_conflict")
      return { kind: "status_conflict", currentStatus: body.currentStatus };
    if (
      body.code === "payment_not_settled" ||
      body.code === "transition_not_allowed"
    )
      return { kind: "conflict", code: body.code };
  } catch {
    // Not the §9.3 body: fall through to a plain HTTP error.
  }
  return { kind: "http", status: 409 };
}
