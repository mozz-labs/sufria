-- =============================================================================
-- 0012 — Bypass #4: which restaurants have a customer notification pending (FR-11)
--
-- The problem this solves, precisely:
--   The notification poller (brief F, docs/15-notifications-brief.md) runs in
--   the Conversation Engine on a timer. There is no inbound message, so there
--   is no phone_number_id to resolve and no tenant context. Under 0003 the
--   engine role then reads zero rows from orders AND from restaurants, so it
--   cannot even learn which tenants to open a context for.
--
--   Same shape as Bypass #2 (resolve_restaurant_by_phone_id) and #3
--   (restaurants_for_staff): a question that must be answered BEFORE tenant
--   context exists, answered by a narrow SECURITY DEFINER function rather than
--   by loosening any policy or granting BYPASSRLS. Approved as an explicit
--   exception to brief F's "no migration" rule, for this point alone.
--
-- The privileged surface, kept as small as it can be:
--   - No input.
--   - Output is SETOF uuid: restaurant ids and nothing else. No order ids, no
--     statuses, no phone numbers, no counts. Every order read and every write
--     after this runs under normal RLS, inside runInTenant.
--   - A restaurant appears only while at least one of its orders has
--     notified = false. idx_orders_unnotified (0002) keeps that O(unnotified).
--   - Suspended restaurants are filtered, as in resolve_restaurant_by_phone_id:
--     a suspended restaurant sends nothing from its number.
--   - EXECUTE for sufria_engine alone. Revoked from PUBLIC (functions are
--     executable by PUBLIC by default) and from sufria_dashboard explicitly.
--
-- SET search_path is not decoration. A SECURITY DEFINER function without it
-- runs with the caller's search_path, and a caller who can create a schema can
-- shadow `orders` with their own table and have this function read it.
--
-- Asserted by tests/security/chain-isolation.sql, A13-A15.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION app.restaurants_with_unnotified_orders()
  RETURNS SETOF uuid
  LANGUAGE sql SECURITY DEFINER STABLE
  SET search_path = public, pg_temp
  AS $$
    SELECT DISTINCT o.restaurant_id
    FROM orders      o
    JOIN restaurants r ON r.id = o.restaurant_id
    WHERE o.notified = false
      AND r.status <> 'suspended'
  $$;

REVOKE ALL ON FUNCTION app.restaurants_with_unnotified_orders() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.restaurants_with_unnotified_orders() FROM sufria_dashboard;
GRANT EXECUTE ON FUNCTION app.restaurants_with_unnotified_orders() TO sufria_engine;

COMMIT;
