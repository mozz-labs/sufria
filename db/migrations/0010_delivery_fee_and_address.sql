-- =============================================================================
-- Sufria — Migration 0010: delivery fee and delivery address
--
-- Task C brief §7. The engine can already build a cart and reach cart_review;
-- it cannot yet say how the food gets to the customer. These columns are the
-- whole of what "delivery" means in the pilot: a fee and a free-text address.
--
-- CAPABILITY IS NOT CHOICE
--   restaurants.offers_delivery (since 0001) is what the restaurant CAN do.
--   orders.fulfillment_type (since 0001) is what THIS order chose. The fee
--   lives on both for the same reason the price does: restaurants.delivery_fee
--   is the current fee, orders.delivery_fee is the one the customer was shown.
--   A restaurant that raises its fee mid-conversation does not change an order
--   already summarised — brief §2.4, "الرسوم وعد".
--
-- numeric(12,2), NOT the minor units the engine computes in
--   Every money column in this schema is numeric(12,2). The engine works in
--   integer piasters end to end and divides by 100 once, in SQL, on write
--   (brief §15.4). Converting the whole database to minor units is a separate
--   decision and deliberately not taken here.
--
-- THE THREE CONSTRAINTS ARE THE SAFETY NET, NOT DECORATION
--   Order creation runs in one transaction that writes orders, order_items and
--   order_status_history (brief §8). If the arithmetic or the fulfillment
--   branch is wrong, these fail the transaction instead of letting a wrong
--   order reach the kitchen. Each one has a rejection test by name in
--   tests/db/critical-primitives.verify.ts.
--
--   orders_total_is_subtotal_plus_fee
--     total is derived, never independently supplied. The engine computes
--     total_minor = subtotal_minor + fee_minor as integers; this proves the
--     three columns still agree after the division by 100.
--
--   orders_pickup_has_no_delivery_data
--     A pickup order carrying a fee or an address means the fulfillment branch
--     leaked. Without this, a customer who switched from delivery to pickup
--     could be charged a delivery fee with no message saying so.
--
--   orders_delivery_has_address
--     A delivery order without an address cannot be delivered. The 1..300
--     bound is the same bound the engine enforces before it stores the text
--     (brief §3); btrim because the engine stores the customer's text with
--     only the edges trimmed, so a trimmed value is what actually arrives.
--
-- No backfill: every existing order is pickup with total = subtotal, so the
-- DEFAULT 0 satisfies all three. There is no production database, and
-- migrations here only ever run against a clean one.
-- =============================================================================

BEGIN;

ALTER TABLE restaurants
  ADD COLUMN delivery_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0);

COMMENT ON COLUMN restaurants.delivery_fee IS
  'What this restaurant currently charges for delivery. 0 is a real value: a restaurant that delivers free. The order snapshots it at the moment the customer picks delivery — see orders.delivery_fee. Task C brief §2.4.';

ALTER TABLE orders
  ADD COLUMN delivery_fee     numeric(12,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  ADD COLUMN delivery_address text NULL;

COMMENT ON COLUMN orders.delivery_fee IS
  'The fee the customer was shown in the summary, snapshotted from restaurants.delivery_fee when they chose delivery. Always 0 for pickup. Task C brief §2.4.';

COMMENT ON COLUMN orders.delivery_address IS
  'The customer''s own words, edges trimmed and nothing else — never normalised, because a driver reads it. NULL for pickup. Task C brief §0.';

ALTER TABLE orders
  ADD CONSTRAINT orders_total_is_subtotal_plus_fee
    CHECK (total = subtotal + delivery_fee),
  ADD CONSTRAINT orders_pickup_has_no_delivery_data
    CHECK (fulfillment_type <> 'pickup' OR (delivery_fee = 0 AND delivery_address IS NULL)),
  ADD CONSTRAINT orders_delivery_has_address
    CHECK (fulfillment_type <> 'delivery'
           OR (delivery_address IS NOT NULL
               AND char_length(btrim(delivery_address)) BETWEEN 1 AND 300));

COMMIT;
