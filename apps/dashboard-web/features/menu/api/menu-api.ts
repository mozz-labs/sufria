/**
 * The menu screen's calls, on the shared client (`shared/api/http.ts`). The
 * shapes are the API's own, from `@sufria/shared` (brief D §9.4–§9.5 and
 * §9.10, as built in brief ي-أ).
 */
import type {
  ArchivedMenuItemListResponse,
  CreateMenuItemRequest,
  CreateMenuItemResponse,
  EnableAllMenuItemsResponse,
  MenuCategoryListResponse,
  MenuItemListResponse,
  UpdateMenuItemRequest,
  UpdateMenuItemResponse,
} from "@sufria/shared";
import { http as browserHttp } from "../../../shared/api/client.ts";
import type { ApiResult, Http } from "../../../shared/api/http.ts";

export type MenuApi = {
  /** The menu, switched-off items included, in the customer's order. */
  listItems(): Promise<ApiResult<MenuItemListResponse>>;
  /** The archived items alone, the most recently archived first. */
  listArchived(): Promise<ApiResult<ArchivedMenuItemListResponse>>;
  /** The active categories, what «أضف» can add to. */
  listCategories(): Promise<ApiResult<MenuCategoryListResponse>>;
  /** 201: available at once, last in its category. 409 `menu_too_long`. */
  createItem(
    body: CreateMenuItemRequest,
  ): Promise<ApiResult<CreateMenuItemResponse>>;
  /**
   * The fields sent alone (brief ي-ب §6), or `archived` alone. 404: not
   * ours, or gone. 409 `item_archived` · `menu_too_long`.
   */
  updateItem(
    id: string,
    body: UpdateMenuItemRequest,
  ): Promise<ApiResult<UpdateMenuItemResponse>>;
  /** «شغّل الكل». 409 `menu_too_long`. */
  enableAll(): Promise<ApiResult<EnableAllMenuItemsResponse>>;
};

export function createMenuApi(http: Http): MenuApi {
  return {
    listItems: () =>
      http.call<MenuItemListResponse>("/menu-items", {
        method: "GET",
        auth: "restaurant",
      }),
    listArchived: () =>
      http.call<ArchivedMenuItemListResponse>("/menu-items?archived=true", {
        method: "GET",
        auth: "restaurant",
      }),
    listCategories: () =>
      http.call<MenuCategoryListResponse>("/menu-categories", {
        method: "GET",
        auth: "restaurant",
      }),
    createItem: (body) =>
      http.call<CreateMenuItemResponse>("/menu-items", {
        method: "POST",
        body,
        auth: "restaurant",
      }),
    updateItem: (id, body) =>
      http.call<UpdateMenuItemResponse>(
        `/menu-items/${encodeURIComponent(id)}`,
        { method: "PATCH", body, auth: "restaurant" },
      ),
    enableAll: () =>
      http.call<EnableAllMenuItemsResponse>("/menu-items/enable-all", {
        method: "POST",
        auth: "restaurant",
      }),
  };
}

/** The browser's menu calls. Tests build their own with `createMenuApi`. */
export const menuApi = createMenuApi(browserHttp);
