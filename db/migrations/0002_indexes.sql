-- =============================================================================
-- Wafa — Migration 0002: Indexes
--
-- Every index here backs a query that appears literally in a sequence diagram
-- (Blueprint §6) or an NFR target. Nothing speculative.
-- =============================================================================

BEGIN;

-- --- Guard hot path -----------------------------------------------------------
-- Read on EVERY authenticated Dashboard API request, before RLS is enabled
-- (diagram 6.4, part A). If this is slow, the whole dashboard is slow.
CREATE INDEX idx_restaurant_staff_lookup
  ON restaurant_staff (staff_account_id, restaurant_id)
  WHERE is_active;

CREATE INDEX idx_restaurant_staff_by_restaurant
  ON restaurant_staff (restaurant_id) WHERE is_active;

-- --- Inbound webhook routing (diagram 6.3) ------------------------------------
-- restaurants.whatsapp_phone_id already UNIQUE -> btree index exists.

-- --- Active session lookup (diagram 6.3) --------------------------------------
-- SELECT ... WHERE restaurant_id=? AND customer_id=? AND state NOT IN
--   ('order_placed','abandoned') ORDER BY last_message_at DESC LIMIT 1
CREATE INDEX idx_sessions_active
  ON conversation_sessions (restaurant_id, customer_id, last_message_at DESC)
  WHERE state NOT IN ('order_placed', 'abandoned');

-- Session-abandonment job: state='awaiting_payment' AND last_message_at < now()-45min
CREATE INDEX idx_sessions_awaiting_payment_timeout
  ON conversation_sessions (last_message_at)
  WHERE state = 'awaiting_payment';

-- FR-19 funnel: counts sessions by furthest state reached in a period.
CREATE INDEX idx_sessions_funnel
  ON conversation_sessions (restaurant_id, created_at DESC);

-- --- Live orders board, FR-12 (polled every 3-5s per open dashboard) ----------
CREATE INDEX idx_orders_board
  ON orders (restaurant_id, created_at DESC)
  WHERE status IN ('pending_acceptance', 'accepted', 'preparing', 'ready');

-- --- Notification poller, FR-11 (diagram 6.4, part E) -------------------------
-- SELECT ... WHERE notified=false LIMIT batch_size — runs every 3-5 seconds
-- forever. A partial index keeps it O(unnotified), not O(all orders).
CREATE INDEX idx_orders_unnotified
  ON orders (created_at)
  WHERE notified = false;

-- --- Scheduler job B-1: 24h unclaimed pickup expiry ---------------------------
-- Uses orders.ready_at, NOT order_status_history. See ADR-002.
CREATE INDEX idx_orders_pickup_expiry
  ON orders (ready_at)
  WHERE status = 'ready' AND fulfillment_type = 'pickup';

-- --- Scheduler job B-2: 2h stuck online payment cancellation ------------------
CREATE INDEX idx_orders_payment_timeout
  ON orders (created_at)
  WHERE payment_status = 'pending_online'
    AND status NOT IN ('cancelled', 'expired', 'completed');

-- --- Payment webhook lookup (diagram 6.2) -------------------------------------
-- orders.payment_gateway_ref already UNIQUE -> btree index exists.

-- --- FR-08 proactive reorder: most recent completed order for this customer ---
CREATE INDEX idx_orders_customer_completed
  ON orders (customer_id, created_at DESC)
  WHERE status = 'completed';

-- --- FR-14 / FR-17 / FR-18 analytics aggregation ------------------------------
CREATE INDEX idx_orders_completed_period
  ON orders (restaurant_id, created_at DESC)
  WHERE status = 'completed';

-- --- Order detail drawer + FR-20 customer timeline ----------------------------
CREATE INDEX idx_order_items_order   ON order_items (order_id);
CREATE INDEX idx_osh_order           ON order_status_history (order_id, changed_at);
CREATE INDEX idx_osh_restaurant_time ON order_status_history (restaurant_id, changed_at DESC);

-- --- Menu rendering for a WhatsApp session (diagram 6.3) ----------------------
CREATE INDEX idx_menu_categories_active
  ON menu_categories (restaurant_id, display_order) WHERE is_active;
CREATE INDEX idx_menu_items_by_category
  ON menu_items (category_id, display_order);

-- --- FR-10 / FR-21 customer lists ---------------------------------------------
CREATE INDEX idx_customers_last_order ON customers (restaurant_id, last_order_at DESC NULLS LAST);
CREATE INDEX idx_customers_vip        ON customers (restaurant_id) WHERE is_vip;

-- --- Dedup gate: UNIQUE(event_id, source) already provides the index ----------
-- Retention: this table grows unboundedly. Prune rows older than 30 days
-- (well beyond any provider's redelivery window). Scheduled in Sprint 2.
CREATE INDEX idx_webhook_events_processed_at ON processed_webhook_events (processed_at);

CREATE INDEX idx_subscriptions_restaurant ON subscriptions (restaurant_id);

COMMIT;
