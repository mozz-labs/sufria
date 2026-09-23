import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * `:id` in `/menu-items/:id`. Not a UUID ← 400 before the database (the same
 * `z.guid()` as the order id, for the same reason: Postgres accepts ids that
 * `z.uuid()` rejects).
 *
 * 🔴 The parameter is `id` and must never become `restaurantId`: the guard
 *    reads `req.params.restaurantId` before the header (brief D §8.1).
 */
const MenuItemIdParamSchema = z.object({
  id: z.guid(),
});

export class MenuItemIdParamDto extends createZodDto(MenuItemIdParamSchema) {}
