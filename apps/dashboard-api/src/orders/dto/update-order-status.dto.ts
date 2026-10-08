import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import {
  MAX_CANCELLATION_REASON_LENGTH,
  ORDER_STATUSES,
  STAFF_TARGET_STATUSES,
} from "@sufria/shared";

/**
 * Body of `PATCH /orders/:id/status` — brief D §3.3, check 1: everything here
 * is a 400 before the transition itself or the database is reached.
 *
 * - `to` is one of `STAFF_TARGET_STATUSES`: `expired` and `pending_acceptance`
 *   are never a staff destination.
 * - A reason with a destination other than `cancelled` → 400, even an empty
 *   one: its presence is the mistake.
 * - `strictObject`: an extra key → 400 instead of being silently swallowed.
 *   A `restaurantId` in the body does nothing (the restaurant is the guard's
 *   alone, §8.1), so a 400 beats letting it through and looking as if it
 *   worked.
 */
const UpdateOrderStatusSchema = z
  .strictObject({
    from: z.enum(ORDER_STATUSES),
    to: z.enum(STAFF_TARGET_STATUSES),
    cancellationReason: z
      .string()
      .trim()
      .max(MAX_CANCELLATION_REASON_LENGTH)
      .optional(),
  })
  .refine((b) => b.cancellationReason === undefined || b.to === "cancelled", {
    message: 'cancellationReason is only accepted with to: "cancelled"',
    path: ["cancellationReason"],
  });

export class UpdateOrderStatusDto extends createZodDto(
  UpdateOrderStatusSchema,
) {}
