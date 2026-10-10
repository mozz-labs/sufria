import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { MenuItemNameSchema, MenuPriceSchema } from "./menu-item-fields.js";

/**
 * Body of `POST /menu-items` — brief ي-أ §5: all three fields. An existing
 * category (decision 7): creating one is out of this brief.
 *
 * 🔴 `strictObject`: a `restaurantId` in the body is a 400, never a second
 *    source of the restaurant — the restaurant is RestaurantContextGuard's
 *    alone (brief D §8.1).
 */
const CreateMenuItemSchema = z.strictObject({
  categoryId: z.guid(),
  name: MenuItemNameSchema,
  price: MenuPriceSchema,
});

export class CreateMenuItemDto extends createZodDto(CreateMenuItemSchema) {}
