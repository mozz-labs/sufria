import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  UseGuards,
} from "@nestjs/common";
import type {
  MenuItemListResponse,
  UpdateMenuItemResponse,
} from "@sufria/shared";
import { VerifiedRestaurantId } from "../auth/decorators/verified-restaurant.decorator.js";
import { RestaurantContextGuard } from "../auth/restaurant-context.guard.js";
import { MenuItemIdParamDto } from "./dto/menu-item-id.dto.js";
import { UpdateMenuItemDto } from "./dto/update-menu-item.dto.js";
import { MenuService } from "./menu.service.js";

/**
 * 🔴 The restaurant is RestaurantContextGuard's (the `x-restaurant-id` header
 *    after the membership check), never the path, body or query. And no path
 *    parameter is ever named `restaurantId` (brief D §8.1).
 */
@Controller("menu-items")
@UseGuards(RestaurantContextGuard)
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @Get()
  list(
    @VerifiedRestaurantId() restaurantId: string,
  ): Promise<MenuItemListResponse> {
    return this.menu.list(restaurantId);
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
    const item = await this.menu.update(restaurantId, params.id, body);
    if (!item) throw new NotFoundException();
    return item;
  }
}
