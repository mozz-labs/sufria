import { Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import type {
  Currency,
  OpeningHours,
  RestaurantSettings,
  UpdateRestaurantSettingsRequest,
} from "@sufria/shared";
import { TenantDbService } from "../db/tenant-db.service.js";

type SettingsRow = {
  currency: Currency;
  offers_delivery: boolean;
  delivery_fee: string;
  contact_phone: string | null;
  business_hours: RestaurantSettings["openingHours"];
};

/** One projection for GET and for the PATCH reply. Assumes `restaurants r`. */
const settingsColumns = () => sql`
  r.currency,
  r.offers_delivery,
  r.delivery_fee::text AS delivery_fee,
  r.contact_phone,
  r.business_hours`;

@Injectable()
export class RestaurantSettingsService {
  constructor(private readonly tenantDb: TenantDbService) {}

  /**
   * `GET /restaurant/settings` — brief D §3.5. No `:id` anywhere: the
   * restaurant is the one RestaurantContextGuard verified (§8.1). `null` only
   * if that restaurant is not visible under its own context, which the guard
   * makes unreachable.
   */
  async get(restaurantId: string): Promise<RestaurantSettings | null> {
    const res = await this.tenantDb.runInTenant(restaurantId, (tx) =>
      tx.execute<SettingsRow>(sql`
        SELECT ${settingsColumns()}
          FROM restaurants r
         WHERE r.id = ${restaurantId}::uuid`),
    );
    const row = res.rows[0];
    return row ? toSettings(row) : null;
  }

  /**
   * `PATCH /restaurant/settings` — brief D §3.5 with §8.6 and §8.8. Only the
   * fields sent are written; `updated_at = now()` in the same UPDATE.
   *
   * 🔴 `openingHours` goes in exactly as the DTO let it through — the
   *    canonical shape the engine reads — with no mapping on the way. The
   *    whole week is replaced at once, never merged day by day.
   *
   * The fee goes in as text and becomes money in SQL (§0). A new fee touches
   * no session that already chose delivery and no order: both hold their own
   * copy («الرسوم وعد»).
   */
  async update(
    restaurantId: string,
    change: UpdateRestaurantSettingsRequest,
  ): Promise<RestaurantSettings | null> {
    const sets: SQL[] = [sql`updated_at = now()`];
    if (change.deliveryFee !== undefined)
      sets.push(sql`delivery_fee = ${change.deliveryFee}::numeric(12,2)`);
    if (change.contactPhone !== undefined)
      sets.push(sql`contact_phone = ${change.contactPhone}`);
    if (change.openingHours !== undefined)
      sets.push(sql`business_hours = ${hoursJson(change.openingHours)}::jsonb`);

    const res = await this.tenantDb.runInTenant(restaurantId, (tx) =>
      tx.execute<SettingsRow>(sql`
        UPDATE restaurants r
           SET ${sql.join(sets, sql`, `)}
         WHERE r.id = ${restaurantId}::uuid
        RETURNING ${settingsColumns()}`),
    );
    const row = res.rows[0];
    return row ? toSettings(row) : null;
  }
}

function hoursJson(hours: OpeningHours): string {
  return JSON.stringify(hours);
}

function toSettings(r: SettingsRow): RestaurantSettings {
  return {
    currency: r.currency,
    offersDelivery: r.offers_delivery,
    // 🔴 As the database returned it. `Number()` here turns "1.50" into "1.5".
    deliveryFee: r.delivery_fee,
    contactPhone: r.contact_phone,
    openingHours: r.business_hours,
  };
}
