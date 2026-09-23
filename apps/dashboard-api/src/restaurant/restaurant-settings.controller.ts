import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  UseGuards,
} from "@nestjs/common";
import type {
  RestaurantSettings,
  UpdateRestaurantSettingsResponse,
} from "@sufria/shared";
import { VerifiedRestaurantId } from "../auth/decorators/verified-restaurant.decorator.js";
import { RestaurantContextGuard } from "../auth/restaurant-context.guard.js";
import { UpdateRestaurantSettingsDto } from "./dto/update-restaurant-settings.dto.js";
import { RestaurantSettingsService } from "./restaurant-settings.service.js";

/**
 * 🔴 No `:id` in the path at all (brief D §3.5). The restaurant is
 *    RestaurantContextGuard's — the `x-restaurant-id` header after the
 *    membership check — never the body or the query (§8.1).
 */
@Controller("restaurant/settings")
@UseGuards(RestaurantContextGuard)
export class RestaurantSettingsController {
  constructor(private readonly settings: RestaurantSettingsService) {}

  @Get()
  async get(
    @VerifiedRestaurantId() restaurantId: string,
  ): Promise<RestaurantSettings> {
    const settings = await this.settings.get(restaurantId);
    if (!settings) throw new NotFoundException();
    return settings;
  }

  @Patch()
  async update(
    @VerifiedRestaurantId() restaurantId: string,
    @Body() body: UpdateRestaurantSettingsDto,
  ): Promise<UpdateRestaurantSettingsResponse> {
    const settings = await this.settings.update(restaurantId, body);
    if (!settings) throw new NotFoundException();
    return settings;
  }
}
