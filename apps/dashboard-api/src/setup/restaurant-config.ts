import { z } from "zod";
import { CURRENCIES, MENU_PRICE_PATTERN } from "@sufria/shared";

import {
  CONTACT_PHONE_PATTERN,
  DELIVERY_FEE_PATTERN,
  OpeningHoursSchema,
} from "../restaurant/dto/update-restaurant-settings.dto.js";

/**
 * The config file of `scripts/setup-restaurant.ts` — brief E §2.2.
 *
 * 🔴 Every rule the dashboard already enforces is imported from its DTO, never
 *    restated: the hours, the fee, the contact number and the price. A second
 *    copy would drift from the first without any test failing, and the hours
 *    are where a near miss is silent — the engine reads a week it does not
 *    recognise as always open (brief D §10).
 *
 * `strictObject` at every level: a key the file should not have is a
 * rejection, never ignored (§2.2).
 */

const NonBlank = z.string().trim().min(1, "must not be blank");

/**
 * The engine resolves the zone through `Intl` (business-hours.ts) and reads an
 * unknown one as always open, so an unknown zone is a rejection here. The
 * resolved name must equal the given one: `Intl` also takes `asia/gaza`, and
 * the column should hold the name as the IANA database spells it.
 */
function isCanonicalTimeZone(zone: string): boolean {
  try {
    return (
      new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions()
        .timeZone === zone
    );
  } catch {
    return false;
  }
}

const MenuItemSchema = z.strictObject({
  name: NonBlank,
  // Positive, as in the dashboard's PATCH — the column's CHECK allows zero.
  price: z
    .string()
    .regex(
      MENU_PRICE_PATTERN,
      "price must be greater than zero, in Western digits, with at most two decimals",
    ),
  isAvailable: z.boolean(),
});

const MenuCategorySchema = z.strictObject({
  name: NonBlank,
  items: z.array(MenuItemSchema).min(1, "a category needs at least one item"),
});

export const RestaurantConfigSchema = z.strictObject({
  name: NonBlank,
  currency: z.enum(CURRENCIES),
  timezone: z
    .string()
    .refine(
      isCanonicalTimeZone,
      'timezone must be an IANA name, e.g. "Asia/Gaza"',
    ),
  offersDelivery: z.boolean(),
  deliveryFee: z
    .string()
    .regex(
      DELIVERY_FEE_PATTERN,
      "deliveryFee must be Western digits with at most two decimals",
    ),
  contactPhone: z
    .string()
    .regex(
      CONTACT_PHONE_PATTERN,
      "contactPhone must be 7 to 15 Western digits, with an optional leading +",
    )
    .nullable(),
  openingHours: OpeningHoursSchema,
  /**
   * 🔴 The NAME of the variable that holds the phone number id, never the id
   *    (§2.3). The pattern is an environment variable name, so an id pasted
   *    here by mistake — digits — is a rejection, not a commit.
   */
  whatsappPhoneIdEnv: z
    .string()
    .regex(
      /^[A-Z_][A-Z0-9_]*$/,
      "whatsappPhoneIdEnv must be the name of an environment variable, e.g. WHATSAPP_PHONE_NUMBER_ID — not the id itself",
    ),
  /** The order in the file is the order the customer sees (§2.2). */
  menu: z
    .array(MenuCategorySchema)
    .min(1, "the menu needs at least one category"),
  /**
   * No password: the script generates one (§2.4). The first account of a
   * restaurant is its owner, and the script only ever creates the first.
   */
  staff: z.strictObject({
    email: z.email(),
    name: NonBlank,
    role: z.literal("owner", {
      error: 'role must be "owner": the first account of a restaurant owns it',
    }),
  }),
});

export type RestaurantConfig = z.infer<typeof RestaurantConfigSchema>;

export type ConfigParseResult =
  { ok: true; config: RestaurantConfig } | { ok: false; errors: string[] };

/**
 * Validates an already-parsed JSON value. Each error is `path: message`.
 * Zod's messages here never repeat the rejected value, so nothing read from
 * the file is echoed back.
 */
export function parseRestaurantConfig(raw: unknown): ConfigParseResult {
  const result = RestaurantConfigSchema.safeParse(raw);
  if (result.success) return { ok: true, config: result.data };
  return {
    ok: false,
    errors: result.error.issues.map(
      (issue) =>
        `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`,
    ),
  };
}
