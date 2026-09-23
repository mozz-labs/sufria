import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/** Brief D §3.5's `deliveryFee`, verbatim. Zero is a real fee: free delivery. */
export const DELIVERY_FEE_PATTERN = /^\d{1,6}(?:\.\d{1,2})?$/;

/** Brief D §3.5's `contactPhone`, verbatim: E.164. */
export const CONTACT_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

/**
 * `"HH:MM"` with two digits each, always. The engine's `TIME_RE` also takes
 * `"9:00"`; the writer does not (brief D §8.8: strict writer, lenient reader).
 * `24:00` is not a time for either.
 */
const HHMM = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;

const WindowSchema = z.strictObject({
  open: z.string().regex(HHMM, 'open must be "HH:MM", e.g. "09:00"'),
  close: z.string().regex(HHMM, 'close must be "HH:MM", e.g. "23:00"'),
});

const DaySchema = WindowSchema.array().optional();

/**
 * The canonical shape alone: the seven short day keys and `{open, close}`.
 * `strictObject` at every level, so `"sunday"`, `"0"`, `{from, to}` and a
 * `timezone` key (moved to its own column by 0008) are a 400 instead of a row
 * the engine reads some other way, or not at all.
 */
const OpeningHoursSchema = z.strictObject({
  days: z.strictObject({
    sun: DaySchema,
    mon: DaySchema,
    tue: DaySchema,
    wed: DaySchema,
    thu: DaySchema,
    fri: DaySchema,
    sat: DaySchema,
  }),
});

/**
 * Body of `PATCH /restaurant/settings` — brief D §3.5 with §8.8. At least one
 * field. `strictObject`, so `currency`, `offersDelivery` and `timezone` are a
 * 400 rather than silently ignored.
 *
 * 🔴 `\d` is `[0-9]` in JS, so a fee in Arabic-Indic digits is a 400 (brief D
 *    §0). Do not normalise the digits before this check.
 */
const UpdateRestaurantSettingsSchema = z
  .strictObject({
    deliveryFee: z
      .string()
      .regex(
        DELIVERY_FEE_PATTERN,
        "deliveryFee must be Western digits with at most two decimals",
      )
      .optional(),
    contactPhone: z
      .string()
      .regex(
        CONTACT_PHONE_PATTERN,
        "contactPhone must be E.164, e.g. +962791234567",
      )
      .optional(),
    openingHours: OpeningHoursSchema.optional(),
  })
  .refine(
    (b) =>
      b.deliveryFee !== undefined ||
      b.contactPhone !== undefined ||
      b.openingHours !== undefined,
    { message: "send deliveryFee, contactPhone, openingHours, or several" },
  );

export class UpdateRestaurantSettingsDto extends createZodDto(
  UpdateRestaurantSettingsSchema,
) {}
