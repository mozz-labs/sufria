import { Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import type {
  MenuItemListItem,
  MenuItemListResponse,
  UpdateMenuItemRequest,
} from "@sufria/shared";
import { TenantDbService } from "../db/tenant-db.service.js";

type MenuItemRow = {
  id: string;
  name: string;
  price: string;
  is_available: boolean;
};

/** One projection for the list and for the PATCH reply. Assumes `menu_items mi`. */
const menuItemColumns = () => sql`
  mi.id,
  mi.name,
  mi.price::text AS price,
  mi.is_available`;

@Injectable()
export class MenuService {
  constructor(private readonly tenantDb: TenantDbService) {}

  /**
   * `GET /menu-items` — brief D §3.4 with §8.3.
   *
   * @param restaurantId from RestaurantContextGuard alone (§8.1). RLS is the
   *   isolation; the explicit `restaurant_id` filter is defence in depth.
   *
   * 🔴 The order is the customer's, to the letter: the ORDER BY of the
   *    engine's `readMenu` (the engine's `restaurant/menu.ts`).
   *    Unavailable items keep their place — staff need them to turn them back
   *    on — while items of an inactive category are left out: the engine calls
   *    them unavailable whatever `is_available` says, so showing them would let
   *    staff switch on an item no customer can order, with no error anywhere.
   */
  async list(restaurantId: string): Promise<MenuItemListResponse> {
    const res = await this.tenantDb.runInTenant(restaurantId, (tx) =>
      tx.execute<MenuItemRow>(sql`
        SELECT ${menuItemColumns()}
          FROM menu_items mi
          JOIN menu_categories mc ON mc.id = mi.category_id
         WHERE mi.restaurant_id = ${restaurantId}::uuid
           AND mc.is_active
         ORDER BY mc.display_order, mc.name, mc.id,
                  mi.display_order, mi.name, mi.id`),
    );
    return { items: res.rows.map(toItem) };
  }

  /**
   * `PATCH /menu-items/:id` — brief D §3.4. `null` = no such item under this
   * restaurant's context, whether it does not exist or belongs to another
   * restaurant: the two are not told apart (§2.9).
   *
   * 🔴 `is_available` is the column the engine's «أكّد» check reads
   *    (`readCatalog`), not a look-alike.
   *
   * Only the fields sent are written, so a price change and an availability
   * change at the same moment do not undo each other. The price goes in as
   * text and becomes money in SQL (§0). A new price touches no cart and no
   * order: both hold a snapshot («السعر وعد»).
   */
  async update(
    restaurantId: string,
    itemId: string,
    change: UpdateMenuItemRequest,
  ): Promise<MenuItemListItem | null> {
    const sets: SQL[] = [sql`updated_at = now()`];
    if (change.isAvailable !== undefined)
      sets.push(sql`is_available = ${change.isAvailable}`);
    if (change.price !== undefined)
      sets.push(sql`price = ${change.price}::numeric(12,2)`);

    const res = await this.tenantDb.runInTenant(restaurantId, (tx) =>
      tx.execute<MenuItemRow>(sql`
        UPDATE menu_items mi
           SET ${sql.join(sets, sql`, `)}
         WHERE mi.id = ${itemId}::uuid
           AND mi.restaurant_id = ${restaurantId}::uuid
        RETURNING ${menuItemColumns()}`),
    );
    const row = res.rows[0];
    return row ? toItem(row) : null;
  }
}

function toItem(r: MenuItemRow): MenuItemListItem {
  return {
    id: r.id,
    name: r.name,
    // 🔴 As the database returned it. `Number()` here turns "2.50" into "2.5".
    price: r.price,
    isAvailable: r.is_available,
  };
}
