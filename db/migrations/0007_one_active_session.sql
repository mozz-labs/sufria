-- =============================================================================
-- Sufria — Migration 0007: at most one active conversation session per customer
--
-- Sprint 1. Makes "open a session on the customer's first message" atomic.
--
-- WHY THIS IS NOT APPLICATION LOGIC
--
-- The engine's first-message path is: look for an active session, and if there
-- is none, create one. Two messages from the same customer arriving milliseconds
-- apart are two DISTINCT webhook events with distinct wa_message_ids, so the
-- dedup gate (processed_webhook_events) lets both through by design — that is
-- exactly what it is for. Both handlers then read "no active session" and both
-- insert. The customer gets two greetings and the restaurant gets two sessions
-- for one conversation, and from the next slice on, two carts.
--
-- A SELECT-then-INSERT cannot close that window, at any isolation level short of
-- SERIALIZABLE. A unique index can, and it turns the race into a conflict the
-- writer can see: INSERT ... ON CONFLICT DO NOTHING RETURNING returns zero rows
-- to the loser, which then reads the winner's row. Same shape as the dedup gate
-- in 0001, for the same reason.
--
-- WHY PARTIAL
--
-- The constraint is on ACTIVE sessions only. A customer who ordered last week
-- (state 'order_placed') and comes back today must be able to start a new
-- session; a full UNIQUE (restaurant_id, customer_id) would give them one
-- conversation for life. The predicate matches idx_sessions_active in 0002 —
-- the same definition of "active" the lookup query uses. If one of the two is
-- ever changed, both must change together, or the index stops covering the
-- query it exists for.
--
-- NO NEW COLUMNS ANYWHERE IN THIS MIGRATION, DELIBERATELY
--
-- tests/db/schema-drift.verify.ts compares columns between the SQL and the
-- Drizzle mirror in packages/shared. An index is invisible to it; a column is
-- not. That is a property of the drift check, not a reason to avoid columns —
-- but this change genuinely needs none.
-- =============================================================================

BEGIN;

CREATE UNIQUE INDEX idx_sessions_one_active_per_customer
  ON conversation_sessions (restaurant_id, customer_id)
  WHERE state NOT IN ('order_placed', 'abandoned');

COMMIT;
