import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import type { OrderListResponse } from "@sufria/shared";
import { VerifiedRestaurantId } from "../auth/decorators/verified-restaurant.decorator.js";
import { RestaurantContextGuard } from "../auth/restaurant-context.guard.js";
import { ListOrdersQueryDto } from "./dto/list-orders.dto.js";
import { OrdersService } from "./orders.service.js";

/**
 * 🔴 المطعم من RestaurantContextGuard (هيدر `x-restaurant-id` بعد التحقّق من
 *    العضوية)، مش من المسار ولا الـquery. وممنوع باراميتر مسار اسمه
 *    `restaurantId`: الحارس بيقرأ `req.params.restaurantId` قبل الهيدر، فهيك
 *    باراميتر بيغيّر مصدر المطعم بصمت (بريف د §8.1).
 */
@Controller("orders")
@UseGuards(RestaurantContextGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(
    @VerifiedRestaurantId() restaurantId: string,
    @Query() query: ListOrdersQueryDto,
  ): Promise<OrderListResponse> {
    return this.orders.list(restaurantId, query.tab, query.page ?? 1);
  }
}
