import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { ORDER_STATUSES, STAFF_TARGET_STATUSES } from "@sufria/shared";

/** بريف د §2.8: الحدّ على السبب بعد القصّ، يعني على اللي بينخزّن. */
export const MAX_CANCELLATION_REASON_LENGTH = 300;

/**
 * جسم `PATCH /orders/:id/status` — بريف د §3.3، فحص 1: كل اللي هون 400 قبل
 * ما نوصل للانتقال نفسه أو للقاعدة.
 *
 * - `to` من `STAFF_TARGET_STATUSES`: `expired` و`pending_acceptance` مش وجهة
 *   من الموظف أبدا.
 * - السبب مع وجهة غير `cancelled` ← 400، حتى لو فاضي: وجوده غلط بحد ذاته.
 * - `strictObject`: مفتاح زيادة ← 400 بدل ما ينبلع بصمت. `restaurantId` بالجسم
 *   ما بيعمل شي (المطعم من الحارس وحده، §8.1)، فالأحسن يرجع 400 من إنه يمرق
 *   ويبيّن كأنه اشتغل.
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
