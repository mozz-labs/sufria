-- =============================================================================
-- Sufria — Migration 0011: order number and restaurant currency
--
-- Task D brief §2.1 and §2.2 (docs/13-dashboard-api-brief.md). Both come from
-- the first real WhatsApp conversation: the confirmation carried no number,
-- and every amount said «د.أ» to a pilot restaurant that sells in shekels.
--
-- ORDER NUMBER — per restaurant, sequential, never reset, starts at 101
--   The customer reaches the counter with nothing to say, and staff have
--   nothing to search by. 101, not 1, so the first customer never reads
--   "order number 1".
--
--   ALLOCATED BY THE ENGINE, INSIDE THE ORDER-CREATION TRANSACTION
--     pg_advisory_xact_lock keyed on the restaurant, then
--     COALESCE(MAX(order_number), 100) + 1. The lock serialises order creation
--     per restaurant and is released at COMMIT. No DEFAULT and no trigger: a
--     writer that forgets the number fails on NOT NULL instead of getting one
--     silently from somewhere nobody reads.
--
--   WHY NOT a counter column on restaurants
--     The engine would need UPDATE on restaurants from its own context, and
--     the RLS policies are not this migration's to change.
--   WHY NOT a daily reset
--     It needs the restaurant's day boundary, and it makes the history
--     ambiguous: "order 104" would name a different order every day.
--
--   orders_restaurant_order_number_unique IS THE SAFETY NET, NOT THE MECHANISM
--     Without the lock, two concurrent orders read the same MAX and the second
--     fails here — a lost order at peak time, which is what the lock is for.
--     Its index on (restaurant_id, order_number) is also what makes MAX cheap.
--
--   BACKFILL
--     Existing orders are numbered per restaurant by created_at, then id, from
--     101. Migrations here only ever run against a clean database, before the
--     seed, so on every machine today this UPDATE matches zero rows — the same
--     position 0008's backfill is in. It was run once against a scratch
--     database carrying the pre-0011 seed plus same-instant orders, to check
--     the ordering and that RLS does not block it (the migration role is the
--     owner and a superuser). The seed carries its own numbers explicitly.
--
-- CURRENCY — a restaurant setting, not a text constant
--   Jordan stays the launch market, so the default is JOD: every existing
--   restaurant, and every existing test, reads exactly as it did. Set at
--   restaurant setup; not editable from the dashboard. No snapshot on orders:
--   the currency does not change in the middle of a conversation.
--   The labels (JOD → د.أ, ILS → شيكل) live in packages/shared, not here.
-- =============================================================================

BEGIN;

ALTER TABLE restaurants
  ADD COLUMN currency text NOT NULL DEFAULT 'JOD'
    CONSTRAINT restaurants_currency_check CHECK (currency IN ('JOD', 'ILS'));

COMMENT ON COLUMN restaurants.currency IS
  'ISO 4217 code of what this restaurant sells in. Every amount the engine sends carries its label (packages/shared). Set at setup, not from the dashboard. Task D brief §2.2.';

ALTER TABLE orders ADD COLUMN order_number integer;

UPDATE orders o
   SET order_number = numbered.order_number
  FROM (
    SELECT id,
           100 + row_number() OVER (PARTITION BY restaurant_id
                                    ORDER BY created_at, id) AS order_number
      FROM orders
  ) AS numbered
 WHERE o.id = numbered.id;

ALTER TABLE orders
  ALTER COLUMN order_number SET NOT NULL,
  ADD CONSTRAINT orders_order_number_positive CHECK (order_number > 0),
  ADD CONSTRAINT orders_restaurant_order_number_unique
    UNIQUE (restaurant_id, order_number);

COMMENT ON COLUMN orders.order_number IS
  'What the customer says at the counter and staff search by. Per restaurant, sequential from 101, never reset. Allocated by the engine under a per-restaurant advisory lock inside the order-creation transaction; the UNIQUE constraint is the safety net. Task D brief §2.1.';

COMMIT;
