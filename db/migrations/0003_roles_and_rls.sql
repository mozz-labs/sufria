-- =============================================================================
-- Wafa — Migration 0003: Database roles, tenant context, Row-Level Security
--
-- This is the file that implements NFR-02. Read it before changing anything in it.
--
-- Three rules it depends on, all of which are easy to break by accident:
--
--   1. The application NEVER connects as the table owner. RLS is silently
--      bypassed for table owners. FORCE ROW LEVEL SECURITY is set anyway as a
--      second line of defence, so that a future misconfigured connection string
--      degrades to "no rows" instead of "all tenants' rows".
--
--   2. The tenant context is set with set_config(..., is_local => true), i.e.
--      transaction-scoped. Never plain SET. On a pooled connection a plain SET
--      persists after the request finishes and the NEXT request to borrow that
--      connection inherits the previous tenant's id. That is a cross-tenant read,
--      and it is invisible in testing until two restaurants are live at once.
--
--   3. The id is passed to set_config as a BIND PARAMETER, never interpolated
--      into the SQL string. `SET LOCAL app.current_restaurant_id = '<id>'` cannot
--      take a bind parameter, which is precisely why it must not be used: string
--      interpolation there is an injection into the tenant boundary itself.
--
-- The three of them are asserted by tests/security/chain-isolation.sql.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Roles
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wafa_dashboard') THEN
    CREATE ROLE wafa_dashboard LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wafa_engine') THEN
    CREATE ROLE wafa_engine LOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO wafa_dashboard, wafa_engine;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO wafa_dashboard, wafa_engine;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO wafa_dashboard, wafa_engine;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO wafa_dashboard, wafa_engine;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT                  ON SEQUENCES TO wafa_dashboard, wafa_engine;

-- Neither app role may create tables, and neither is BYPASSRLS.
-- The two legitimate bypasses are narrow SECURITY DEFINER functions, below.

-- -----------------------------------------------------------------------------
-- Tenant context
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA app TO wafa_dashboard, wafa_engine;

-- Returns NULL when no context is set. Every policy compares against this, so
-- "no context" evaluates to NULL, which is not TRUE, which filters every row.
-- The system fails closed, never open.
-- NULLIF guards the empty string: ''::uuid raises, and a raise inside a policy
-- turns a data-isolation failure into a 500, which is harder to reason about.
CREATE OR REPLACE FUNCTION app.current_restaurant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.current_restaurant_id', true), '')::uuid $$;

GRANT EXECUTE ON FUNCTION app.current_restaurant() TO wafa_dashboard, wafa_engine;

-- -----------------------------------------------------------------------------
-- Bypass #1 — the authorization Guard.
--
-- The Guard has to answer "is this staff account an active member of this
-- restaurant?" BEFORE any tenant context exists. It cannot read restaurant_staff
-- under RLS, because RLS on that table is itself keyed on the context.
-- So: one SECURITY DEFINER function that returns a boolean and nothing else.
-- It leaks no rows, no ids, no names — only yes/no for a pair the caller already
-- holds. That is the entire privileged surface of the Dashboard API.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.verify_membership(p_staff_account_id uuid, p_restaurant_id uuid)
  RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE
  SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1
      FROM restaurant_staff rs
      JOIN staff_accounts   sa ON sa.id = rs.staff_account_id
      JOIN restaurants      r  ON r.id  = rs.restaurant_id
      WHERE rs.staff_account_id = p_staff_account_id
        AND rs.restaurant_id    = p_restaurant_id
        AND rs.is_active
        AND sa.is_active
        AND r.status <> 'suspended'
    )
  $$;

REVOKE ALL ON FUNCTION app.verify_membership(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.verify_membership(uuid, uuid) TO wafa_dashboard;

-- -----------------------------------------------------------------------------
-- Bypass #2 — inbound WhatsApp webhook routing.
--
-- The Conversation Engine starts from a Meta phone_number_id and has no logged-in
-- staff member, so it cannot have a tenant context before it resolves one.
-- Rather than granting the engine BYPASSRLS (which would make every query in the
-- service unconstrained), it gets one function that maps phone_id -> restaurant_id.
-- Everything the engine does after that runs under normal RLS.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.resolve_restaurant_by_phone_id(p_phone_id text)
  RETURNS uuid
  LANGUAGE sql SECURITY DEFINER STABLE
  SET search_path = public, pg_temp
  AS $$
    SELECT id FROM restaurants
    WHERE whatsapp_phone_id = p_phone_id
      AND status <> 'suspended'
  $$;

REVOKE ALL ON FUNCTION app.resolve_restaurant_by_phone_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_restaurant_by_phone_id(text) TO wafa_engine;

-- -----------------------------------------------------------------------------
-- RLS policies
-- -----------------------------------------------------------------------------

-- restaurants: a request may see exactly the one restaurant in its context.
-- A sibling branch under the same chain_id is NOT visible. The chain is a data
-- relationship, never an access grant (Decision #7).
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurants FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON restaurants
  USING      (id = app.current_restaurant())
  WITH CHECK (id = app.current_restaurant());

-- restaurant_staff: readable within the current restaurant only.
-- The Guard does not read through this policy; it calls app.verify_membership().
ALTER TABLE restaurant_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_staff FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON restaurant_staff
  USING      (restaurant_id = app.current_restaurant())
  WITH CHECK (restaurant_id = app.current_restaurant());

-- Straightforward tenant-keyed tables.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'menu_categories', 'menu_items', 'customers', 'conversation_sessions',
    'orders', 'order_items', 'order_status_history', 'subscriptions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (restaurant_id = app.current_restaurant())
         WITH CHECK (restaurant_id = app.current_restaurant())', t);
  END LOOP;
END $$;

-- message_templates: restaurant_id NULL means a platform-provided default,
-- readable by everyone, writable by no tenant.
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON message_templates FOR SELECT
  USING (restaurant_id = app.current_restaurant() OR restaurant_id IS NULL);
CREATE POLICY tenant_write ON message_templates FOR ALL
  USING      (restaurant_id = app.current_restaurant())
  WITH CHECK (restaurant_id = app.current_restaurant());

-- -----------------------------------------------------------------------------
-- Deliberately WITHOUT RLS — each one is a decision, not an omission:
--
--   staff_accounts            read during login, before any restaurant context
--                             can exist. Protected at the application layer.
--                             Contains no tenant business data.
--   processed_webhook_events  written by the dedup gate before the restaurant is
--                             resolved, including on the first message of a new
--                             conversation (diagram 6.3). Contains only opaque
--                             provider event ids.
-- -----------------------------------------------------------------------------

COMMIT;
