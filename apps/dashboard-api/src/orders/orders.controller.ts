import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import type {
  OrderDetail,
  OrderListResponse,
  OrderStatusConflictBody,
  UpdateOrderStatusResponse,
} from "@sufria/shared";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { VerifiedRestaurantId } from "../auth/decorators/verified-restaurant.decorator.js";
import { RestaurantContextGuard } from "../auth/restaurant-context.guard.js";
import { ListOrdersQueryDto } from "./dto/list-orders.dto.js";
import { OrderIdParamDto } from "./dto/order-id.dto.js";
import { UpdateOrderStatusDto } from "./dto/update-order-status.dto.js";
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

  /**
   * بريف د §3.3 بترتيب الفحص: 400 (الـDTO) ← 409 `transition_not_allowed` ←
   * 404 ← 409 `status_conflict` أو `payment_not_settled`. والـ200 هو الطلب
   * بشكل عنصر `GET /orders`.
   *
   * `actor_staff_id` من التوكن (`CurrentUser`)، والمطعم من الحارس.
   */
  @Patch(":id/status")
  async changeStatus(
    @VerifiedRestaurantId() restaurantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: OrderIdParamDto,
    @Body() body: UpdateOrderStatusDto,
  ): Promise<UpdateOrderStatusResponse> {
    const outcome = await this.orders.changeStatus(
      restaurantId,
      user.staffAccountId,
      params.id,
      body,
    );
    switch (outcome.kind) {
      case "changed":
        return outcome.order;
      case "not_found":
        throw new NotFoundException();
      case "transition_not_allowed":
        throw conflict({
          code: "transition_not_allowed",
          message: `${body.from} → ${body.to} is not a staff transition`,
        });
      case "status_conflict":
        throw conflict({
          code: "status_conflict",
          message: `the order is ${outcome.currentStatus}, not ${body.from}`,
          currentStatus: outcome.currentStatus,
        });
      case "payment_not_settled":
        throw conflict({
          code: "payment_not_settled",
          message: "only a cash order, or a paid one, can be completed",
        });
    }
  }
}

type ConflictDetail = OrderStatusConflictBody extends infer B
  ? B extends OrderStatusConflictBody
    ? Omit<B, "statusCode" | "error">
    : never
  : never;

/**
 * 409 بشكل Nest الافتراضي ومعه `code` — بريف د §8.7. الشاشة بتقرأ `code`،
 * و`message` إنجليزي للمطوّر.
 */
function conflict(detail: ConflictDetail): ConflictException {
  const body: OrderStatusConflictBody = {
    statusCode: 409,
    error: "Conflict",
    ...detail,
  };
  return new ConflictException(body);
}
