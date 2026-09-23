import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { OrderDetail, OrderListResponse } from "@sufria/shared";
import { VerifiedRestaurantId } from "../auth/decorators/verified-restaurant.decorator.js";
import { RestaurantContextGuard } from "../auth/restaurant-context.guard.js";
import { ListOrdersQueryDto } from "./dto/list-orders.dto.js";
import { OrderIdParamDto } from "./dto/order-id.dto.js";
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

  /**
   * غير موجود ولمطعم تاني نفس الـ404 بنفس الجسم (بريف د §2.9): ما منقول
   * للمطعم التاني إن الطلب موجود. وRLS أصلا ما بتفرّق بينهم.
   */
  @Get(":id")
  async detail(
    @VerifiedRestaurantId() restaurantId: string,
    @Param() params: OrderIdParamDto,
  ): Promise<OrderDetail> {
    const order = await this.orders.detail(restaurantId, params.id);
    if (!order) throw new NotFoundException();
    return order;
  }
}
