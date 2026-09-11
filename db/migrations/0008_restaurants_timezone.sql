-- =============================================================================
-- Sufria — Migration 0008: restaurants.timezone
--
-- Moves the restaurant's IANA timezone out of the business_hours jsonb and into
-- a real column.
--
-- WHY IT WAS EVER INSIDE THE JSONB
--   The engine's business-hours gate needed a timezone, and the note in
--   CLAUDE.md recorded the reason for hiding it in jsonb as: "restaurants is
--   mirrored in packages/shared and a new column there is a schema-drift
--   failure."
--
--   That reason does not hold. A new column is a drift failure only when the
--   SQL changes and the mirror does not; changing both together is the entire
--   point of tests/db/schema-drift.verify.ts. Migration 0007 already said so in
--   its own header — "that is a property of the drift check, not a reason to
--   avoid columns". So the drift check was never the obstacle, and the cost of
--   working around it was real: an untyped, unvalidated, undocumented key that
--   the settings screen would have had to guess at.
--
-- THE SHAPE, BEFORE AND AFTER
--   before:  business_hours = {"timezone": "Asia/Amman",
--                              "days": {"sun": [{"open":"09:00","close":"23:00"}]}}
--   after:   timezone       = 'Asia/Amman'            ← column, this migration
--            business_hours = {"days": {"sun": [...]}}
--
--   The `timezone` key inside business_hours is gone, not merely ignored. Two
--   writable homes for one fact is what produced this migration; leaving the
--   old key readable would keep both alive and let a settings screen write to
--   the one nothing reads. Anything that still sends it gets a warning logged
--   by apps/conversation-engine/src/restaurant/business-hours.ts.
--
-- NOT NULL WITH A DEFAULT, NOT NULLABLE
--   Every restaurant is somewhere. A NULL timezone would push a fallback into
--   every read site and give each one its own chance to pick a different one;
--   the default belongs in one place. 'Asia/Amman' matches DEFAULT_TIMEZONE in
--   the engine and the JOD default in subscriptions.
--
-- The backfill below is a no-op on a clean database (business_hours defaults to
-- '{}'), and migrations here only ever run on a clean database. It exists
-- because a developer with a populated dev database should not silently lose a
-- timezone they configured, and because it is the only executable record of
-- where the value used to live.
-- =============================================================================

BEGIN;

ALTER TABLE restaurants
  ADD COLUMN timezone text NOT NULL DEFAULT 'Asia/Amman';

-- Rejects '' and '   '. A stricter CHECK is not possible: validating an IANA
-- name means reading pg_timezone_names, which is not immutable and therefore
-- not allowed in a CHECK. An unknown-but-non-empty name is handled at read
-- time — Intl throws, and the gate falls back to "open" like any other
-- malformed input.
ALTER TABLE restaurants
  ADD CONSTRAINT restaurants_timezone_not_blank
  CHECK (length(btrim(timezone)) > 0);

-- Backfill: take the old jsonb value only when it is a string AND a timezone
-- Postgres actually knows. A name that never resolved was already being
-- ignored at read time (Intl threw, the gate answered "open"), so preferring
-- the default over it loses nothing that was ever honoured.
UPDATE restaurants
   SET timezone = business_hours ->> 'timezone'
 WHERE jsonb_typeof(business_hours -> 'timezone') = 'string'
   AND length(btrim(business_hours ->> 'timezone')) > 0
   AND EXISTS (
     SELECT 1 FROM pg_timezone_names
      WHERE name = business_hours ->> 'timezone'
   );

-- One home for the fact. Runs after the backfill, in the same transaction.
UPDATE restaurants
   SET business_hours = business_hours - 'timezone'
 WHERE business_hours ? 'timezone';

COMMENT ON COLUMN restaurants.timezone IS
  'IANA timezone name. Moved out of business_hours jsonb by 0008. The business-hours gate reads this; business_hours now carries only {days:{...}}.';

COMMIT;
