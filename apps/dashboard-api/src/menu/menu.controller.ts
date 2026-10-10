import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import type {
  ArchivedMenuItemListResponse,
  CreateMenuItemResponse,
  EnableAllMenuItemsResponse,
  MenuCategoryListResponse,
  MenuConflictBody,
  MenuItemListResponse,
  UpdateMenuItemResponse,
} from "@sufria/shared";
import { VerifiedRestaurantId } from "../auth/decorators/verified-restaurant.decorator.js";
import { RestaurantContextGuard } from "../auth/restaurant-context.guard.js";
import { CreateMenuItemDto } from "./dto/create-menu-item.dto.js";
import { ListMenuItemsQueryDto } from "./dto/list-menu-items.dto.js";
import { MenuItemIdParamDto } from "./dto/menu-item-id.dto.js";
import { UpdateMenuItemDto } from "./dto/update-menu-item.dto.js";
import { MenuService, type MenuTooLong } from "./menu.service.js";

/**
 * 🔴 The restaurant is RestaurantContextGuard's (the `x-restaurant-id` header
 *    after the membership check), never the path, body or query. And no path
 *    parameter is ever named `restaurantId` (brief D §8.1).
 */
@Controller("menu-items")
@UseGuards(RestaurantContextGuard)
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  /** The menu, or with `?archived=true` the archived items (brief ي-أ §5). */
  @Get()
  list(
    @VerifiedRestaurantId() restaurantId: string,
    @Query() query: ListMenuItemsQueryDto,
  ): Promise<MenuItemListResponse | ArchivedMenuItemListResponse> {
    return query.archived === "true"
      ? this.menu.listArchived(restaurantId)
      : this.menu.list(restaurantId);
  }

  /**
   * Brief ي-أ §5: 201 and the item. A category of another restaurant, or an
   * inactive one, is the 404 a non-existent one gets (brief D §2.9).
   */
  @Post()
  async create(
    @VerifiedRestaurantId() restaurantId: string,
    @Body() body: CreateMenuItemDto,
  ): Promise<CreateMenuItemResponse> {
    const outcome = await this.menu.create(restaurantId, body);
    switch (outcome.kind) {
      case "created":
        return outcome.item;
      case "not_found":
        throw new NotFoundException();
      case "menu_too_long":
        throw menuTooLong(outcome);
    }
  }

  /** «شغّل الكل» (brief ي-أ §5). 200, not 201: nothing is created. */
  @Post("enable-all")
  @HttpCode(200)
  async enableAll(
    @VerifiedRestaurantId() restaurantId: string,
  ): Promise<EnableAllMenuItemsResponse> {
    const outcome = await this.menu.enableAll(restaurantId);
    switch (outcome.kind) {
      case "enabled":
        return { enabled: outcome.enabled };
      case "menu_too_long":
        throw menuTooLong(outcome);
    }
  }

  /**
   * Another restaurant's item gets the very 404 a non-existent id gets
   * (brief D §2.9).
   */
  @Patch(":id")
  async update(
    @VerifiedRestaurantId() restaurantId: string,
    @Param() params: MenuItemIdParamDto,
    @Body() body: UpdateMenuItemDto,
  ): Promise<UpdateMenuItemResponse> {
    const outcome = await this.menu.update(restaurantId, params.id, body);
    switch (outcome.kind) {
      case "updated":
        return outcome.item;
      case "not_found":
        throw new NotFoundException();
      case "item_archived":
        throw menuConflict({
          code: "item_archived",
          message: "the item is archived: only archived: false applies to it",
        });
      case "menu_too_long":
        throw menuTooLong(outcome);
    }
  }
}

/** `GET /menu-categories` — brief ي-أ §5. */
@Controller("menu-categories")
@UseGuards(RestaurantContextGuard)
export class MenuCategoriesController {
  constructor(private readonly menu: MenuService) {}

  @Get()
  list(
    @VerifiedRestaurantId() restaurantId: string,
  ): Promise<MenuCategoryListResponse> {
    return this.menu.categories(restaurantId);
  }
}

type MenuConflictDetail = MenuConflictBody extends infer B
  ? B extends MenuConflictBody
    ? Omit<B, "statusCode" | "error">
    : never
  : never;

/**
 * A 409 in Nest's default shape plus `code` — the shape of brief D §8.7. The
 * screen reads `code`; `message` is English, for the developer.
 */
function menuConflict(detail: MenuConflictDetail): ConflictException {
  const body: MenuConflictBody = {
    statusCode: 409,
    error: "Conflict",
    ...detail,
  };
  return new ConflictException(body);
}

function menuTooLong(outcome: MenuTooLong): ConflictException {
  return menuConflict({
    code: "menu_too_long",
    message: `the first message would be ${outcome.length} characters, over WhatsApp's ${outcome.limit}`,
    length: outcome.length,
    limit: outcome.limit,
  });
}
