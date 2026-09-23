import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * `:id` in `/orders/:id`. Not a UUID → 400 before it reaches the database
 * (brief D §3.2).
 *
 * `z.guid()`, not `z.uuid()`: the latter checks the version and variant
 * digits, so it rejects ids Postgres accepts. The same shape
 * RestaurantContextGuard checks.
 *
 * 🔴 The parameter is `id` and must never become `restaurantId`: the guard
 *    reads `req.params.restaurantId` before the header (brief D §8.1).
 */
const OrderIdParamSchema = z.object({
  id: z.guid(),
});

export class OrderIdParamDto extends createZodDto(OrderIdParamSchema) {}
