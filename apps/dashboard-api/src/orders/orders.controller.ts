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
 * 🔴 The restaurant is RestaurantContextGuard's (the `x-restaurant-id` header
 *    after the membership check), never the path or the query. And no path
 *    parameter may be named `restaurantId`: the guard reads
 *    `req.params.restaurantId` before the header, so such a parameter would
 *    silently change where the restaurant comes from (brief D §8.1).
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
   * A non-existent order and another restaurant's get the same 404 with the
   * same body (brief D §2.9): the other restaurant is not told the order
   * exists. RLS cannot tell the two apart anyway.
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
   * Brief D §3.3, in check order: 400 (the DTO) → 409 `transition_not_allowed`
   * → 404 → 409 `status_conflict` or `payment_not_settled`. The 200 is the
   * order in the shape of a `GET /orders` item.
   *
   * `actor_staff_id` comes from the token (`CurrentUser`), the restaurant from
   * the guard.
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
          message: `only a cash order, or a paid one, can be ${body.to}`,
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
 * A 409 in Nest's default shape plus `code` — brief D §8.7. The screen reads
 * `code`; `message` is English, for the developer.
 */
function conflict(detail: ConflictDetail): ConflictException {
  const body: OrderStatusConflictBody = {
    statusCode: 409,
    error: "Conflict",
    ...detail,
  };
  return new ConflictException(body);
}
