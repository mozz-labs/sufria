-- =============================================================================
-- Sufria — Migration 0014: pausing orders, and archiving a menu item
-- (brief ي-أ §2, 8 October 2026)
--
-- What the menu screen (brief ي-ب) needs from the database, and nothing else.
--
-- restaurants.orders_paused_at — NULL: the restaurant takes orders. Otherwise
--   orders are paused, since that moment (Mohammed's decisions 1 and 2): the
--   engine answers every message with one text while it is set, a customer in
--   the middle of an order included, and writes no order.
--
-- menu_items.archived_at — NULL: the item is on the menu. Otherwise it is
--   archived — «removed from the menu» — since that moment (decision 4).
--   Archiving is not deleting: the row stays, staff can bring it back, and it
--   comes back switched off.
--
-- menu_items_archived_not_available IS THE GUARANTEE
--   An archived item cannot be available, whatever the code above it does. The
--   dashboard API writes the two together; a bug that forgets one of them is
--   rejected here (23514) instead of putting an archived item back in front of
--   customers.
--
-- WHY THE ENGINE NEEDS NO LINE FOR ARCHIVING
--   It already treats is_available = false as «not on the menu»: readMenu
--   leaves the item out, and readCatalog calls it unavailable — at every add,
--   at every new menu_map, and inside the «أكّد» transaction (cart brief §16).
--   With this constraint, archived implies unavailable, so each of those paths
--   handles an archived item exactly as a switched-off one, and no engine code
--   needs to know archived_at exists.
--
-- No index, no grant, no policy: 0003's grants are table-level, so they cover
-- the new columns, and both tables keep their RLS as it is.
-- =============================================================================

BEGIN;
ALTER TABLE restaurants ADD COLUMN orders_paused_at timestamptz NULL;
ALTER TABLE menu_items  ADD COLUMN archived_at      timestamptz NULL;
ALTER TABLE menu_items
  ADD CONSTRAINT menu_items_archived_not_available
  CHECK (archived_at IS NULL OR is_available = false);
COMMIT;
