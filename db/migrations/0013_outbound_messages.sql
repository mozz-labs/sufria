-- =============================================================================
-- Sufria — Migration 0013: outbound_messages (brief I §4, I-4)
--
-- Every WhatsApp text the engine actually sent, so an order's details can show
-- the whole conversation: the customer's messages (inbound_messages, 0006) and
-- the replies. The one migration of brief I, by Mohammed's decision of
-- 5 October 2026.
--
-- Written by the Conversation Engine alone, through one wrapper around its
-- sender (src/whatsapp/saving-sender.ts), AFTER a send succeeded and under the
-- message's restaurant; read by the dashboard API (GET /orders/:id/messages).
-- A send that failed has no row: this is what went out, nothing else. Messages
-- sent before this migration have no row, by design.
--
-- In the spirit of inbound_messages: the restaurant, the customer's number
-- (the very digits of customers.phone_number and inbound_messages.from_phone —
-- Meta's `from`, no +), the text, when it went. order_id is set by the status
-- notifications alone: they are sent after their transaction committed. A
-- message sent while a transaction is open carries none — the wrapper writes
-- from another connection, which cannot see that transaction's rows — and the
-- API attributes it by the customer's last message before it.
-- =============================================================================

BEGIN;

CREATE TABLE outbound_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  to_phone      text NOT NULL,
  body          text NOT NULL,
  order_id      uuid NULL,
  sent_at       timestamptz NOT NULL DEFAULT now(),

  -- The tenant key of order_items and order_status_history (0001): an order
  -- of another restaurant cannot be named here, not even by mistake.
  FOREIGN KEY (order_id, restaurant_id)
    REFERENCES orders (id, restaurant_id) ON DELETE CASCADE
);

-- One customer's replies in time order — the read GET /orders/:id/messages
-- does, beside idx_inbound_messages_conversation.
CREATE INDEX idx_outbound_messages_conversation
  ON outbound_messages (restaurant_id, to_phone, sent_at);

-- -----------------------------------------------------------------------------
-- RLS. The shape of 0006, verbatim.
-- -----------------------------------------------------------------------------
ALTER TABLE outbound_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_messages FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON outbound_messages
  USING      (restaurant_id = app.current_restaurant())
  WITH CHECK (restaurant_id = app.current_restaurant());

-- 0003's default privileges already grant these; restated, as 0006 does, so
-- the table is still usable if a future migration runs under another owner.
GRANT SELECT, INSERT, UPDATE, DELETE ON outbound_messages TO sufria_dashboard, sufria_engine;

COMMIT;
