/**
 * «أوقف الطلبات مؤقتا» and «استأنف» — `PATCH /restaurant/orders-pause`
 * (brief ي-أ §5). A file of its own: the strip under the header, on every
 * page, needs this call alone — not the menu screen's.
 */
import type { OrdersPauseRequest, OrdersPauseResponse } from "@sufria/shared";
import { http as browserHttp } from "../../../shared/api/client.ts";
import type { ApiResult, Http } from "../../../shared/api/http.ts";

export type OrdersPauseApi = {
  /** `{ ordersPausedAt }`: pausing again keeps the first moment. */
  setPaused(paused: boolean): Promise<ApiResult<OrdersPauseResponse>>;
};

export function createOrdersPauseApi(http: Http): OrdersPauseApi {
  return {
    setPaused: (paused) => {
      const body: OrdersPauseRequest = { paused };
      return http.call<OrdersPauseResponse>("/restaurant/orders-pause", {
        method: "PATCH",
        body,
        auth: "restaurant",
      });
    },
  };
}

/** The browser's call. Tests build their own with `createOrdersPauseApi`. */
export const ordersPauseApi = createOrdersPauseApi(browserHttp);
