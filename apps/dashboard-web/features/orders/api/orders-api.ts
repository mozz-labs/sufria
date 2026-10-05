/**
 * The orders screens' calls, on the shared client (`shared/api/http.ts`). The
 * shapes are the API's own, from `@sufria/shared` (brief D §9).
 */
import type {
  OrderListItem,
  OrderListResponse,
  OrderTab,
  RestaurantSettings,
  StaffTargetStatus,
  UpdateOrderStatusRequest,
  UpdateOrderStatusResponse,
} from "@sufria/shared";
import { http as browserHttp } from "../../../shared/api/client.ts";
import type { ApiResult, Http } from "../../../shared/api/http.ts";

export type OrdersApi = {
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
  /** The restaurant's currency, for every amount on the screen. */
  restaurantSettings(): Promise<ApiResult<RestaurantSettings>>;
};

export function createOrdersApi(http: Http): OrdersApi {
  return {
    listOrders: (tab, page = 1) =>
      http.call<OrderListResponse>(
        `/orders?tab=${tab}${tab === "history" ? `&page=${page}` : ""}`,
        { method: "GET", auth: "restaurant" },
      ),
    changeStatus: (shown, to) => {
      const body: UpdateOrderStatusRequest = { from: shown.status, to };
      return http.call<UpdateOrderStatusResponse>(
        `/orders/${encodeURIComponent(shown.id)}/status`,
        { method: "PATCH", body, auth: "restaurant" },
      );
    },
    restaurantSettings: () =>
      http.call<RestaurantSettings>("/restaurant/settings", {
        method: "GET",
        auth: "restaurant",
      }),
  };
}

/** The browser's orders calls. Tests build their own with `createOrdersApi`. */
export const ordersApi = createOrdersApi(browserHttp);
