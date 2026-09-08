-- =============================================================================
-- Sufria — Migration 0006: inbound_messages (S1-01)
--
-- Storage for every inbound WhatsApp message the webhook accepts. It is written
-- by the Conversation Engine only, after the signature check and the dedup gate,
-- and always under a tenant context.
--
-- Why a raw payload column and not just the parsed fields: the order state
-- machine does not exist yet. When it lands it will need to re-read what Meta
-- actually sent — interactive replies, list selections, media ids — and a
-- webhook that discarded the envelope leaves nothing to reprocess. Storing the
-- message object costs a few hundred bytes and buys the ability to rebuild.
--
-- What is deliberately NOT here: customer_id and session_id. Resolving a
-- customer and continuing a session is S1-04. Adding the columns now would mean
-- either a nullable FK nobody fills or a half-implemented upsert; the migration
-- that needs them will add them.
-- =============================================================================

BEGIN;

CREATE TABLE inbound_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,

  -- Meta's message id (wamid.*). Same value the dedup gate claims in
  -- processed_webhook_events, kept here so a stored row can be traced back to
  -- the event that admitted it.
  wa_message_id   text NOT NULL,
  -- The phone_number_id the message arrived on, i.e. what routing keyed on.
  -- Denormalised from restaurants on purpose: a restaurant may change its
  -- WhatsApp number, and this must keep saying which number actually received
  -- this message.
  phone_number_id text NOT NULL,
  from_phone      text NOT NULL,

  -- Meta's own type discriminator ('text', 'interactive', 'image', ...). Left as
  -- text rather than an enum: Meta adds message types on its own schedule, and
  -- an unknown value must be storable, not a migration emergency.
  message_type    text NOT NULL,
  -- Plain text body when there is one. NULL for media, location, stickers.
  body            text NULL,
  payload         jsonb NOT NULL,

  -- Meta's timestamp for the message, distinct from when we received it.
  -- The gap between them is delivery lag, and it is worth being able to measure.
  sent_at         timestamptz NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),

  -- Second line of defence under the dedup gate. The gate
  -- (processed_webhook_events) is what stops reprocessing; this makes a double
  -- row physically impossible even if a future code path forgets to claim.
  -- Scoped to the restaurant, not global: a UNIQUE on wa_message_id alone would
  -- let one tenant's insert fail because of a row it is not allowed to see.
  UNIQUE (restaurant_id, wa_message_id)
);

-- Conversation history for one customer, newest first — the read the order
-- state machine will do on every turn.
CREATE INDEX idx_inbound_messages_conversation
  ON inbound_messages (restaurant_id, from_phone, received_at DESC);

-- -----------------------------------------------------------------------------
-- RLS. Same shape as every other tenant-keyed table in 0003.
--
-- FORCE matters here even though the engine never connects as the owner: it
-- means a future misconfigured connection string degrades to "no rows" instead
-- of "every restaurant's messages".
-- -----------------------------------------------------------------------------
ALTER TABLE inbound_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_messages FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inbound_messages
  USING      (restaurant_id = app.current_restaurant())
  WITH CHECK (restaurant_id = app.current_restaurant());

-- 0003 sets ALTER DEFAULT PRIVILEGES for postgres in schema public, so a table
-- created by a migration already carries these grants. Restated explicitly so
-- the table is still usable if a future migration runs under a different owner.
GRANT SELECT, INSERT, UPDATE, DELETE ON inbound_messages TO sufria_dashboard, sufria_engine;

COMMIT;
