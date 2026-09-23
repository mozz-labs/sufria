import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/** Brief D §3.5's `deliveryFee`, verbatim. Zero is a real fee: free delivery. */
export const DELIVERY_FEE_PATTERN = /^\d{1,6}(?:\.\d{1,2})?$/;

/**
 * D-6.1: the local form (`07…`, `059…`) and the international one alike, as
 * restaurants actually write their number — the seed holds `0790000099`. No
 * spaces, no dashes, and `[0-9]` spelt out: Arabic-Indic digits are a 400.
 */
export const CONTACT_PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

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

/**
 * 🔴 Required, every day, in every PATCH (D-6.1). A closed day is `[]`, never
 *    a missing key. The engine reads a week in which it recognises no day as
 *    always open — `{}`, `{ days: {} }`, or keys it does not know — so the
 *    dashboard is never allowed to write one.
 */
const DaySchema = WindowSchema.array();

/**
 * The canonical shape alone: the seven short day keys and `{open, close}`.
 * A window whose `close` is earlier than its `open` runs past midnight
 * (`18:00` → `02:00`); the engine reads its tail on the next day.
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
    // `null` clears the number: the handoff message then sends nothing (0009).
    contactPhone: z
      .string()
      .regex(
        CONTACT_PHONE_PATTERN,
        "contactPhone must be 7 to 15 Western digits, with an optional leading +",
      )
      .nullable()
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
