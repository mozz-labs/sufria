/**
 * The orders screens' calls, on the shared client (`shared/api/http.ts`). The
 * shapes are the API's own, from `@sufria/shared` (brief D §9).
 */
import type {
  OrderDetail,
  OrderListItem,
  OrderListResponse,
  OrderMessagesResponse,
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
   * 🔴 `from` is the status the screen **showed** (brief D §2.7), taken from
   *    the order the card or the details page holds — never re-read before
   *    sending. `cancellationReason` with `cancelled` alone, and only when
   *    there is one (brief I §4, I-6).
   */
  changeStatus(
    shown: Pick<OrderListItem, "id" | "status">,
    to: StaffTargetStatus,
    cancellationReason?: string,
  ): Promise<ApiResult<UpdateOrderStatusResponse>>;
  /** One order with its lines and history (brief D §9.2). 404: not ours. */
  orderDetail(id: string): Promise<ApiResult<OrderDetail>>;
  /** The order's conversation (brief I §4, I-5). 404: not ours. */
  orderMessages(id: string): Promise<ApiResult<OrderMessagesResponse>>;
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
    changeStatus: (shown, to, cancellationReason) => {
      const body: UpdateOrderStatusRequest =
        cancellationReason === undefined
          ? { from: shown.status, to }
          : { from: shown.status, to, cancellationReason };
      return http.call<UpdateOrderStatusResponse>(
        `/orders/${encodeURIComponent(shown.id)}/status`,
        { method: "PATCH", body, auth: "restaurant" },
      );
    },
    orderDetail: (id) =>
      http.call<OrderDetail>(`/orders/${encodeURIComponent(id)}`, {
        method: "GET",
        auth: "restaurant",
      }),
    orderMessages: (id) =>
      http.call<OrderMessagesResponse>(
        `/orders/${encodeURIComponent(id)}/messages`,
        { method: "GET", auth: "restaurant" },
      ),
    restaurantSettings: () =>
      http.call<RestaurantSettings>("/restaurant/settings", {
        method: "GET",
        auth: "restaurant",
      }),
  };
}

/** The browser's orders calls. Tests build their own with `createOrdersApi`. */
export const ordersApi = createOrdersApi(browserHttp);
