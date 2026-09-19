-- =============================================================================
-- Sufria — Migration 0009: restaurants.contact_phone
--
-- The human number the handoff message gives a stuck customer after three
-- consecutive messages we could not understand:  للطلب مباشرة: {رقم المطعم}
-- Cart brief §11.3.
--
-- WHY NOT whatsapp_number
--   whatsapp_number is the number the customer is messaging at that very
--   moment. Handing it back as "order directly on this number" is a closed
--   loop — worse than saying nothing. In the pilot the human number is the
--   restaurant's main number, because the bot takes a second one: a restaurant
--   hands over its main number only once a manual reply inbox exists.
--
-- NULLABLE, NO CHECK, NO FORMAT
--   Filled by hand with one UPDATE for the single pilot restaurant; the settings
--   screen is Sprint 3. NULL is a real state, not an error: the handoff then
--   sends nothing at all — no fallback text. A message without a number gives
--   the customer no new path, and an apology without an exit is noise.
--   No CHECK and no format, because nothing reads the value except to print it,
--   and a format rule written now would be written before anyone has seen what
--   restaurants actually enter.
--
-- No backfill: there is no production database, and migrations here only ever
-- run against a clean one.
-- =============================================================================

BEGIN;

ALTER TABLE restaurants ADD COLUMN contact_phone text NULL;

COMMENT ON COLUMN restaurants.contact_phone IS
  'Human phone number the handoff message gives a stuck customer. NULL = the handoff sends nothing, by decision. Not whatsapp_number, which is the bot''s own number. Cart brief §11.3.';

COMMIT;
