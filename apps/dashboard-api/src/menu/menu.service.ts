import { Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import {
  WHATSAPP_TEXT_LIMIT,
  firstMenuMessageAr,
  priceToMinor,
  renderMenuText,
  whatsappTextLength,
  type ArchivedMenuItem,
  type ArchivedMenuItemListResponse,
  type CreateMenuItemRequest,
  type Currency,
  type MenuCategoryListResponse,
  type MenuItemListItem,
  type MenuItemListResponse,
  type UpdateMenuItemResponse,
} from "@sufria/shared";
import { isoUtc } from "../db/iso-utc.js";
import { TenantDbService, type TenantTx } from "../db/tenant-db.service.js";

type MenuItemRow = {
  id: string;
  name: string;
  price: string;
  is_available: boolean;
  category_id: string;
  category_name: string;
  archived_at: string | null;
};

/**
 * One projection for every item this service returns. Assumes `menu_items mi`
 * joined to `menu_categories mc`.
 */
const menuItemColumns = () => sql`
  mi.id,
  mi.name,
  mi.price::text AS price,
  mi.is_available,
  mi.category_id,
  mc.name AS category_name,
  ${isoUtc("mi.archived_at")} AS archived_at`;

/**
 * 🔴 The customer's order, to the letter: the ORDER BY of the engine's
 *    `readMenu` (the engine's `restaurant/menu.ts`) — written there and here,
 *    a gap `CLAUDE.md` records. Assumes `mc` and `mi`.
 */
const customerOrder = () => sql`
  mc.display_order, mc.name, mc.id, mi.display_order, mi.name, mi.id`;

/** A change that would make the first message too long — brief ي-أ §5. */
export type MenuTooLong = {
  kind: "menu_too_long";
  /** The first message's length after the change, in characters. */
  length: number;
  limit: number;
};

export type CreateMenuItemOutcome =
  | { kind: "created"; item: MenuItemListItem }
  | { kind: "not_found" }
  | MenuTooLong;

export type UpdateMenuItemOutcome =
  | { kind: "updated"; item: UpdateMenuItemResponse }
  | { kind: "not_found" }
  | { kind: "item_archived" }
  | MenuTooLong;

export type EnableAllOutcome =
  { kind: "enabled"; enabled: number } | MenuTooLong;

/** What `PATCH /menu-items/:id` may change, as its DTO lets it through. */
export type MenuItemChange = {
  name?: string;
  price?: string;
  isAvailable?: boolean;
  archived?: boolean;
};

/** Thrown inside the transaction to roll the change back; caught right outside it. */
class MenuTooLongError extends Error {
  constructor(readonly length: number) {
    super(`the first message would be ${length} characters`);
  }
}

@Injectable()
export class MenuService {
  constructor(private readonly tenantDb: TenantDbService) {}

  /**
   * `GET /menu-items` — brief D §3.4 with §8.3, and brief ي-أ §5.
   *
   * @param restaurantId from RestaurantContextGuard alone (§8.1). RLS is the
   *   isolation; the explicit `restaurant_id` filter is defence in depth.
   *
   * 🔴 The order is the customer's, to the letter (`customerOrder`).
   *    Unavailable items keep their place — staff need them to turn them back
   *    on — while archived items are left out (brief ي-أ, decision 4: off the
   *    menu, and off the staff's list), and so are the items of an inactive
   *    category: the engine calls them unavailable whatever `is_available`
   *    says, so showing them would let staff switch on an item no customer can
   *    order, with no error anywhere.
   */
  async list(restaurantId: string): Promise<MenuItemListResponse> {
    const res = await this.tenantDb.runInTenant(restaurantId, (tx) =>
      tx.execute<MenuItemRow>(sql`
        SELECT ${menuItemColumns()}
          FROM menu_items mi
          JOIN menu_categories mc ON mc.id = mi.category_id
         WHERE mi.restaurant_id = ${restaurantId}::uuid
           AND mc.is_active
           AND mi.archived_at IS NULL
         ORDER BY ${customerOrder()}`),
    );
    return { items: res.rows.map(toItem) };
  }

  /**
   * `GET /menu-items?archived=true` — brief ي-أ §5: the archived items alone,
   * the most recently archived first. Not those of an inactive category, as
   * in `list`: brought back, such an item would show nowhere.
   */
  async listArchived(
    restaurantId: string,
  ): Promise<ArchivedMenuItemListResponse> {
    const res = await this.tenantDb.runInTenant(restaurantId, (tx) =>
      tx.execute<MenuItemRow>(sql`
        SELECT ${menuItemColumns()}
          FROM menu_items mi
          JOIN menu_categories mc ON mc.id = mi.category_id
         WHERE mi.restaurant_id = ${restaurantId}::uuid
           AND mc.is_active
           AND mi.archived_at IS NOT NULL
         ORDER BY mi.archived_at DESC, mi.id`),
    );
    return { items: res.rows.map(toArchived) };
  }

  /**
   * `GET /menu-categories` — brief ي-أ §5: the active ones, in the menu's
   * order. What `POST /menu-items` may add to (decision 7: an existing
   * category).
   */
  async categories(restaurantId: string): Promise<MenuCategoryListResponse> {
    const res = await this.tenantDb.runInTenant(restaurantId, (tx) =>
      tx.execute<{ id: string; name: string }>(sql`
        SELECT mc.id, mc.name
          FROM menu_categories mc
         WHERE mc.restaurant_id = ${restaurantId}::uuid
           AND mc.is_active
         ORDER BY mc.display_order, mc.name, mc.id`),
    );
    return { categories: res.rows.map((r) => ({ id: r.id, name: r.name })) };
  }

  /**
   * `POST /menu-items` — brief ي-أ §5. Available from its first moment, and
   * last in its category: `display_order` one past the category's largest —
   * archived items counted, so one brought back later keeps its own place.
   *
   * `not_found`: the category is not this restaurant's, does not exist, or is
   * inactive — nothing is written, and the three are not told apart.
   */
  async create(
    restaurantId: string,
    item: CreateMenuItemRequest,
  ): Promise<CreateMenuItemOutcome> {
    return this.guarded<CreateMenuItemOutcome>(restaurantId, async (tx) => {
      const inserted = await tx.execute<{ id: string }>(sql`
        INSERT INTO menu_items (restaurant_id, category_id, name, price,
                                is_available, display_order)
        SELECT ${restaurantId}::uuid, mc.id, ${item.name},
               ${item.price}::numeric(12,2), true,
               COALESCE((SELECT MAX(x.display_order)
                           FROM menu_items x
                          WHERE x.category_id = mc.id), -1) + 1
          FROM menu_categories mc
         WHERE mc.id = ${item.categoryId}::uuid
           AND mc.restaurant_id = ${restaurantId}::uuid
           AND mc.is_active
        RETURNING id`);
      const id = inserted.rows[0]?.id;
      if (!id) return { kind: "not_found" };
      return { kind: "created", item: toItem(await readItem(tx, id)) };
    });
  }

  /**
   * `PATCH /menu-items/:id` — brief D §3.4 and brief ي-أ §5. `not_found` = no
   * such item under this restaurant's context, whether it does not exist or
   * belongs to another restaurant: the two are not told apart (D §2.9).
   *
   * Only the fields sent are written, so a price change and an availability
   * change at the same moment do not undo each other. The price goes in as
   * text and becomes money in SQL (D §0). A new price touches no cart and no
   * order: both hold a snapshot («السعر وعد»).
   *
   * 🔴 An archived item takes `archived: false` alone: any other change is
   *    `item_archived` (409) — `isAvailable: true` among them, which the
   *    constraint `menu_items_archived_not_available` (0014) would refuse in
   *    the database anyway; that refusal is turned into the same 409, never a
   *    500.
   */
  async update(
    restaurantId: string,
    itemId: string,
    change: MenuItemChange,
  ): Promise<UpdateMenuItemOutcome> {
    if (change.archived !== undefined)
      return this.setArchived(restaurantId, itemId, change.archived);

    const sets: SQL[] = [sql`updated_at = now()`];
    if (change.name !== undefined) sets.push(sql`name = ${change.name}`);
    if (change.isAvailable !== undefined)
      sets.push(sql`is_available = ${change.isAvailable}`);
    if (change.price !== undefined)
      sets.push(sql`price = ${change.price}::numeric(12,2)`);

    const run = async (tx: TenantTx): Promise<UpdateMenuItemOutcome> => {
      const updated = await tx.execute<{ id: string }>(sql`
        UPDATE menu_items mi
           SET ${sql.join(sets, sql`, `)}
         WHERE mi.id = ${itemId}::uuid
           AND mi.restaurant_id = ${restaurantId}::uuid
           AND mi.archived_at IS NULL
        RETURNING mi.id`);
      if (!updated.rows[0]) {
        // Only to tell 404 from 409, in the same transaction — never to build
        // the UPDATE on.
        const archived = await tx.execute(sql`
          SELECT 1
            FROM menu_items
           WHERE id = ${itemId}::uuid
             AND restaurant_id = ${restaurantId}::uuid
             AND archived_at IS NOT NULL`);
        return archived.rows[0]
          ? { kind: "item_archived" }
          : { kind: "not_found" };
      }
      return { kind: "updated", item: toUpdated(await readItem(tx, itemId)) };
    };

    // 🔴 The guard on what can lengthen the first message (brief ي-أ §5): a
    //    name, a price, or an item switched on. Switching one off only ever
    //    shortens it.
    const lengthens =
      change.name !== undefined ||
      change.price !== undefined ||
      change.isAvailable === true;
    try {
      return lengthens
        ? await this.guarded(restaurantId, run)
        : await this.tenantDb.runInTenant(restaurantId, run);
    } catch (error) {
      if (isArchivedButAvailable(error)) return { kind: "item_archived" };
      throw error;
    }
  }

  /**
   * `archived: true` — `archived_at` and `is_available = false` in one UPDATE
   * (the constraint holds them together); already archived keeps its first
   * moment. `archived: false` — `archived_at = NULL`, and `is_available` stays
   * as it is: off (decision 4 — staff switch it back on). Neither lengthens
   * the first message, so neither is guarded.
   */
  private async setArchived(
    restaurantId: string,
    itemId: string,
    archived: boolean,
  ): Promise<UpdateMenuItemOutcome> {
    const sets = archived
      ? sql`archived_at = COALESCE(mi.archived_at, now()),
             is_available = false`
      : sql`archived_at = NULL`;
    return this.tenantDb.runInTenant(restaurantId, async (tx) => {
      const updated = await tx.execute<{ id: string }>(sql`
        UPDATE menu_items mi
           SET ${sets}, updated_at = now()
         WHERE mi.id = ${itemId}::uuid
           AND mi.restaurant_id = ${restaurantId}::uuid
        RETURNING mi.id`);
      if (!updated.rows[0]) return { kind: "not_found" };
      return { kind: "updated", item: toUpdated(await readItem(tx, itemId)) };
    });
  }

  /**
   * `POST /menu-items/enable-all` — «شغّل الكل», brief ي-أ §5 and decision 7:
   * every switched-off item that is not archived, in the categories staff see
   * (the same as `list`). `enabled` = how many changed. There is no «switch
   * everything off».
   */
  async enableAll(restaurantId: string): Promise<EnableAllOutcome> {
    return this.guarded<EnableAllOutcome>(restaurantId, async (tx) => {
      const enabled = await tx.execute<{ id: string }>(sql`
        UPDATE menu_items mi
           SET is_available = true, updated_at = now()
          FROM menu_categories mc
         WHERE mc.id = mi.category_id
           AND mi.restaurant_id = ${restaurantId}::uuid
           AND mc.is_active
           AND NOT mi.is_available
           AND mi.archived_at IS NULL
        RETURNING mi.id`);
      return { kind: "enabled", enabled: enabled.rows.length };
    });
  }

  /**
   * 🔴 The 4096 guard — brief ي-أ §5. `change` runs, then the first message
   *    — the welcome with the restaurant's name, and the menu: the longest
   *    menu message the engine sends — is built again from the database, in
   *    the same transaction, by the very functions the engine builds it with
   *    (`packages/shared`), and counted the way WhatsApp counts.
   *
   *    Longer than the limit AND longer than before → the transaction rolls
   *    back and the outcome is `menu_too_long`. «Longer than before» is what
   *    lets a menu that is already too long — written by the setup script,
   *    say — take a change that does not lengthen it, and every change that
   *    shortens it: that is how it recovers.
   */
  private async guarded<T extends { kind: string }>(
    restaurantId: string,
    change: (tx: TenantTx) => Promise<T>,
  ): Promise<T | MenuTooLong> {
    try {
      return await this.tenantDb.runInTenant(restaurantId, async (tx) => {
        const before = await firstMessageLength(tx, restaurantId);
        const outcome = await change(tx);
        const after = await firstMessageLength(tx, restaurantId);
        if (after > WHATSAPP_TEXT_LIMIT && after > before)
          throw new MenuTooLongError(after);
        return outcome;
      });
    } catch (error) {
      if (!(error instanceof MenuTooLongError)) throw error;
      return {
        kind: "menu_too_long",
        length: error.length,
        limit: WHATSAPP_TEXT_LIMIT,
      };
    }
  }
}

/**
 * The first message as the engine would send it now — from this
 * transaction's view of the database — counted as WhatsApp counts.
 *
 * 🔴 The engine's filter, to the letter: an available item in an active
 *    category (an archived item is never available — 0014). The text is
 *    built by `renderMenuText` and `firstMenuMessageAr`, the engine's own
 *    functions, so the guard cannot measure a message the engine never sends.
 */
async function firstMessageLength(
  tx: TenantTx,
  restaurantId: string,
): Promise<number> {
  const restaurant = await tx.execute<{ name: string; currency: Currency }>(sql`
    SELECT r.name, r.currency
      FROM restaurants r
     WHERE r.id = ${restaurantId}::uuid`);
  const row = restaurant.rows[0];
  if (!row) throw new Error(`restaurant ${restaurantId} is not readable here`);

  const lines = await tx.execute<{
    name: string;
    price: string;
    category_id: string;
    category_name: string;
  }>(sql`
    SELECT mi.name, mi.price::text AS price,
           mc.id AS category_id, mc.name AS category_name
      FROM menu_items mi
      JOIN menu_categories mc ON mc.id = mi.category_id
     WHERE mi.restaurant_id = ${restaurantId}::uuid
       AND mc.is_active
       AND mi.is_available
     ORDER BY ${customerOrder()}`);

  const text = renderMenuText(
    lines.rows.map((l, i) => ({
      number: i + 1,
      name: l.name,
      // The engine's one conversion path for a price (`readMenu`).
      priceMinor: priceToMinor(l.price),
      categoryId: l.category_id,
      categoryName: l.category_name,
    })),
    row.currency,
  );
  return whatsappTextLength(firstMenuMessageAr(row.name, text));
}

async function readItem(tx: TenantTx, itemId: string): Promise<MenuItemRow> {
  const res = await tx.execute<MenuItemRow>(sql`
    SELECT ${menuItemColumns()}
      FROM menu_items mi
      JOIN menu_categories mc ON mc.id = mi.category_id
     WHERE mi.id = ${itemId}::uuid`);
  const row = res.rows[0];
  if (!row) throw new Error(`menu item ${itemId} vanished mid-transaction`);
  return row;
}

/**
 * The refusal of `menu_items_archived_not_available` (0014, SQLSTATE 23514),
 * on the pg error itself or on drizzle's `cause`.
 */
function isArchivedButAvailable(error: unknown): boolean {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  return candidates.some((e) => {
    const pg = e as { code?: unknown; constraint?: unknown } | null;
    return (
      pg?.code === "23514" &&
      pg.constraint === "menu_items_archived_not_available"
    );
  });
}

function toItem(r: MenuItemRow): MenuItemListItem {
  return {
    id: r.id,
    name: r.name,
    // 🔴 As the database returned it. `Number()` here turns "2.50" into "2.5".
    price: r.price,
    isAvailable: r.is_available,
    categoryId: r.category_id,
    categoryName: r.category_name,
  };
}

/** Only for a row the query held to `archived_at IS NOT NULL`. */
function toArchived(r: MenuItemRow): ArchivedMenuItem {
  return { ...toItem(r), archivedAt: r.archived_at! };
}

function toUpdated(r: MenuItemRow): UpdateMenuItemResponse {
  return { ...toItem(r), archivedAt: r.archived_at };
}
