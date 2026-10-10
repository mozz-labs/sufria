import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { MenuItemNameSchema, MenuPriceSchema } from "./menu-item-fields.js";

/**
 * Body of `PATCH /menu-items/:id` — brief ي-أ §5: one or more of `name`,
 * `price` and `isAvailable`, or `archived` alone (with anything else, a 400).
 * `strictObject`, so a key the contract does not have (`restaurantId`,
 * `categoryId`) is a 400 rather than silently ignored.
 *
 * `name` and `price` reach the service normalised (`menu-item-fields.ts`).
 */
const UpdateMenuItemSchema = z
  .strictObject({
    name: MenuItemNameSchema.optional(),
    price: MenuPriceSchema.optional(),
    isAvailable: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .superRefine((body, ctx) => {
    const fields = [body.name, body.price, body.isAvailable].filter(
      (value) => value !== undefined,
    ).length;
    if (body.archived !== undefined && fields > 0)
      ctx.addIssue({
        code: "custom",
        message: "archived goes alone, without name, price or isAvailable",
      });
    else if (body.archived === undefined && fields === 0)
      ctx.addIssue({
        code: "custom",
        message: "send name, price, isAvailable — or archived alone",
      });
  });

export class UpdateMenuItemDto extends createZodDto(UpdateMenuItemSchema) {}
