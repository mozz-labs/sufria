import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  notInArray,
  sql,
} from "drizzle-orm";
import {
  MAX_QTY_PER_ITEM,
  customers,
  orderItems,
  orders,
  reorderBlockAr,
  type Currency,
  type OrderStatus,
} from "@sufria/shared";

import type { TenantTx } from "../db/types.js";
import type { Catalog } from "../restaurant/catalog.js";
import type { StoredReorder } from "./session-data.js";

/**
 * «آخر طلب لك» — FR-08, brief ك.
 *
 * Two halves, the repo's usual shape: `findReorderSource` reads the
 * customer's last accepted order (I/O, inside the message's transaction,
 * under the restaurant's RLS), and `buildReorderSuggestion` turns it into
 * the block and what the session keeps (pure).
 *
 * 🔴 Not a menu path. It reads no menu and sends nothing: the block reaches
 *    the customer inside the first message, which `prepareMenu` builds and
 *    `deliverMenu` sends — still the only way a menu's text goes out.
 */

/**
 * Statuses that count as "the restaurant accepted it" (decision 2).
 * `pending_acceptance` is not yet, `cancelled` and `expired` never were
 * delivered.
 */
const ACCEPTED_STATUSES = [
  "accepted",
  "preparing",
  "ready",
  "completed",
] as const satisfies readonly OrderStatus[];

/** Statuses that are not an order at all for decision 3. */
const DEAD_STATUSES = [
  "cancelled",
  "expired",
] as const satisfies readonly OrderStatus[];

/**
 * The customer's last accepted order, as today's menu will read it: one
 * entry per item, quantities summed across lines (`order_items` may hold
 * one item twice), capped at `MAX_QTY_PER_ITEM`, and a line whose
 * `menu_item_id` is NULL (the row was deleted) left out.
 */
export interface ReorderSource {
  readonly orderId: string;
  readonly items: readonly { readonly itemId: string; readonly qty: number }[];
}

/**
 * The source of the suggestion, or `null` when there is none:
 *
 *   1. no customer with this number at this restaurant;
 *   2. 🔴 any order not cancelled or expired in the last `minAgeMinutes`
 *      (decision 3): a customer asking «وين طلبي؟» about an order still on
 *      its way is not offered «كرّر نفس الطلب»;
 *   3. no order the restaurant accepted, or one whose every line lost its item.
 *
 * 🔴 The age is the database's clock — `now()`, the message transaction's
 *    start — never Node's, like the session timeout (brief ح §0): `created_at`
 *    is written by the database, so it is read against the same clock.
 *
 * No `restaurant_id` written here: 0003's RLS confines every table to the
 * restaurant of the message, as in `findActiveSession`. The same number at
 * another restaurant is another customer, whose orders this cannot see.
 */
export async function findReorderSource(
  tx: TenantTx,
  phone: string,
  minAgeMinutes: number,
): Promise<ReorderSource | null> {
  const [customer] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.phoneNumber, phone))
    .limit(1);
  if (customer === undefined) return null;

  // Both queries carry `status NOT IN ('cancelled', 'expired')` — the
  // predicate of 0015's partial index, so it serves them both.
  const [recent] = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.customerId, customer.id),
        notInArray(orders.status, [...DEAD_STATUSES]),
        sql`${orders.createdAt} > now() - make_interval(mins => ${minAgeMinutes})`,
      ),
    )
    .limit(1);
  if (recent !== undefined) return null;

  const [last] = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.customerId, customer.id),
        notInArray(orders.status, [...DEAD_STATUSES]),
        inArray(orders.status, [...ACCEPTED_STATUSES]),
      ),
    )
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(1);
  if (last === undefined) return null;

  const lines = await tx
    .select({ itemId: orderItems.menuItemId, qty: orderItems.quantity })
    .from(orderItems)
    .where(
      and(eq(orderItems.orderId, last.id), isNotNull(orderItems.menuItemId)),
    );

  const qtyOf = new Map<string, number>();
  for (const line of lines) {
    if (line.itemId === null) continue;
    qtyOf.set(line.itemId, (qtyOf.get(line.itemId) ?? 0) + line.qty);
  }
  if (qtyOf.size === 0) return null;

  return {
    orderId: last.id,
    items: [...qtyOf].map(([itemId, qty]) => ({
      itemId,
      qty: Math.min(qty, MAX_QTY_PER_ITEM),
    })),
  };
}

/** The block as the first message shows it, and what the session keeps. */
export interface ReorderSuggestion {
  /** `reorderBlockAr`'s text — welcome and menu around it are not here. */
  readonly block: string;
  /** Written to `context.reorder` by `deliverMenu`, with `menu_map`. */
  readonly stored: StoredReorder;
}

/**
 * The suggestion from its source and today's menu — **pure**.
 *
 * - Today's names and prices (decision 6), read live by `readCatalog`.
 * - An item not available today — switched off, archived (0014: archived is
 *   never available) or in a switched-off category: `readCatalog`'s own
 *   criterion — is not shown; the «غير متوفر الآن» line names it (decision 7).
 * - 🔴 **No item available: no suggestion at all** (decision 7) — `null`, and
 *   the first message is the plain one.
 * - The lines in today's menu order (`order_items` has no order column):
 *   `menuOrder` holds each shown item's position. The missing ones, which
 *   today's menu does not show, by name.
 *
 * @param menuOrder item id → its position in the menu about to be sent.
 */
export function buildReorderSuggestion(
  source: ReorderSource,
  catalog: Catalog,
  menuOrder: ReadonlyMap<string, number>,
  currency: Currency,
): ReorderSuggestion | null {
  const shown: {
    itemId: string;
    name: string;
    qty: number;
    unitPriceMinor: number;
  }[] = [];
  const missing: string[] = [];

  for (const { itemId, qty } of source.items) {
    const entry = catalog.get(itemId);
    // A row gone entirely has no name to say «غير متوفر» about.
    if (entry === undefined) continue;
    if (!entry.available) {
      missing.push(entry.name);
      continue;
    }
    shown.push({
      itemId,
      name: entry.name,
      qty,
      unitPriceMinor: entry.unitPriceMinor,
    });
  }
  if (shown.length === 0) return null;

  const position = (id: string): number =>
    menuOrder.get(id) ?? Number.MAX_SAFE_INTEGER;
  shown.sort((a, b) => position(a.itemId) - position(b.itemId));
  missing.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return {
    block: reorderBlockAr(
      shown.map((l) => ({
        name: l.name,
        qty: l.qty,
        lineTotalMinor: l.qty * l.unitPriceMinor,
      })),
      missing,
      currency,
    ),
    stored: {
      order_id: source.orderId,
      items: shown.map((l) => ({
        item_id: l.itemId,
        name: l.name,
        qty: l.qty,
      })),
    },
  };
}
