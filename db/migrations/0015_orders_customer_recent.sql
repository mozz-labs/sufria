-- 0015: FR-08 — the customer's recent orders, for the reorder suggestion.
-- One partial index serves both questions of brief K: "any non-cancelled
-- order in the last N minutes?" and "the latest accepted one?".
-- idx_orders_customer_completed (0002) stays: it is completed-only.
BEGIN;
CREATE INDEX idx_orders_customer_recent
  ON orders (customer_id, created_at DESC)
  WHERE status NOT IN ('cancelled', 'expired');
COMMIT;
