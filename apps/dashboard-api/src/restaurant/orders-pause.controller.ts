import {
  Body,
  Controller,
  NotFoundException,
  Patch,
  UseGuards,
} from "@nestjs/common";
import type { OrdersPauseResponse } from "@sufria/shared";
import { VerifiedRestaurantId } from "../auth/decorators/verified-restaurant.decorator.js";
import { RestaurantContextGuard } from "../auth/restaurant-context.guard.js";
import { OrdersPauseDto } from "./dto/orders-pause.dto.js";
import { RestaurantSettingsService } from "./restaurant-settings.service.js";

/**
 * «أوقف الطلبات مؤقتا» — brief ي-أ §5. Like the settings: no `:id` in the
 * path, the restaurant is RestaurantContextGuard's (brief D §8.1).
 */
@Controller("restaurant/orders-pause")
@UseGuards(RestaurantContextGuard)
export class OrdersPauseController {
  constructor(private readonly settings: RestaurantSettingsService) {}

  @Patch()
  async set(
    @VerifiedRestaurantId() restaurantId: string,
    @Body() body: OrdersPauseDto,
  ): Promise<OrdersPauseResponse> {
    const pause = await this.settings.setOrdersPaused(
      restaurantId,
      body.paused,
    );
    if (!pause) throw new NotFoundException();
    return pause;
  }
}
