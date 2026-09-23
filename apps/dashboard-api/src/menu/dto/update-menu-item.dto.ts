import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * Brief D §3.4, verbatim. Zero is rejected by the pattern itself — `0`,
 * `0.0`, `00.00` — never by turning the text into a number in JS. Six integer
 * digits and two decimals fit `numeric(12,2)`.
 *
 * 🔴 `\d` is `[0-9]` in JS, with or without the `u` flag, so `٢.٥٠` is a 400
 *    (brief D §0) — on purpose. Do not normalise the digits before this check:
 *    a price in Arabic-Indic digits that got through would be one nobody reads.
 */
export const MENU_PRICE_PATTERN = /^(?!0+(?:\.0+)?$)\d{1,6}(?:\.\d{1,2})?$/;

/**
 * Body of `PATCH /menu-items/:id`. At least one field; `strictObject` so a key
 * the contract does not have (`name`, `restaurantId`) is a 400 rather than
 * silently ignored — renaming an item is out of D (§2.10).
 */
const UpdateMenuItemSchema = z
  .strictObject({
    isAvailable: z.boolean().optional(),
    price: z
      .string()
      .regex(
        MENU_PRICE_PATTERN,
        "price must be greater than zero, in Western digits, with at most two decimals",
      )
      .optional(),
  })
  .refine((b) => b.isAvailable !== undefined || b.price !== undefined, {
    message: "send isAvailable, price, or both",
  });

export class UpdateMenuItemDto extends createZodDto(UpdateMenuItemSchema) {}
