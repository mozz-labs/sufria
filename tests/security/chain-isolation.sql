-- =============================================================================
-- MANDATORY SPRINT 0 SECURITY GATE — chain isolation
--
-- Blueprint §5.5: "اختبار عزل السلاسل (staff_account بصفين لمطعمين مختلفين)
-- إلزامي بنهاية Sprint 0 / بداية Sprint 1، قبل أي فيتشر يُبنى فوق الـguard."
--
-- Run:  psql -v ON_ERROR_STOP=1 -f tests/security/chain-isolation.sql
-- Any failing assertion raises and aborts. Silence + "ALL 15 ASSERTIONS PASSED"
-- is the only passing output. No feature may be built on the Guard until this
-- prints that line in CI.
-- =============================================================================

\set ON_ERROR_STOP on
\set QUIET on

DO $$ BEGIN RAISE NOTICE 'running chain-isolation security gate...'; END $$;

-- =============================================================================
-- A1. No tenant context => zero rows. The system fails CLOSED.
-- =============================================================================
BEGIN;
  SET ROLE sufria_dashboard;
  DO $$
  DECLARE n int;
  BEGIN
    SELECT count(*) INTO n FROM orders;
    IF n <> 0 THEN
      RAISE EXCEPTION 'A1 FAILED: % orders visible with no tenant context (must be 0 — fail closed)', n;
    END IF;
    SELECT count(*) INTO n FROM customers;
    IF n <> 0 THEN RAISE EXCEPTION 'A1 FAILED: % customers visible with no context', n; END IF;
    SELECT count(*) INTO n FROM restaurants;
    IF n <> 0 THEN RAISE EXCEPTION 'A1 FAILED: % restaurants visible with no context', n; END IF;
  END $$;
  RESET ROLE;
ROLLBACK;

-- =============================================================================
-- A2. THE CASE THIS WHOLE FILE EXISTS FOR.
--     staff #1 is an active manager of BOTH branch A and branch B.
--     With context = A, branch B's data must be completely invisible.
--     An application-level `WHERE restaurant_id = ?` passes this by luck.
--     A forgotten one does not. RLS makes forgetting impossible.
-- =============================================================================
BEGIN;
  SET ROLE sufria_dashboard;
  DO $ctx$ BEGIN PERFORM set_config('app.current_restaurant_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true); END $ctx$;
  DO $$
  DECLARE n int; leaked text;
  BEGIN
    SELECT count(*) INTO n FROM orders;
    IF n <> 1 THEN RAISE EXCEPTION 'A2 FAILED: expected 1 order for branch A, got %', n; END IF;

    SELECT count(*) INTO n FROM orders WHERE restaurant_id <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    IF n <> 0 THEN RAISE EXCEPTION 'A2 FAILED: % foreign-tenant orders leaked into branch A context', n; END IF;

    -- Sibling branch of the SAME chain must be invisible. The chain is a data
    -- relationship, never an access grant.
    SELECT count(*) INTO n FROM customers WHERE phone_number = '+962790000002';
    IF n <> 0 THEN RAISE EXCEPTION 'A2 FAILED: sibling-branch customer visible from branch A context'; END IF;

    SELECT string_agg(name, ',') INTO leaked FROM restaurants;
    IF leaked <> 'شاورما الأصيل — فرع الشميساني' THEN
      RAISE EXCEPTION 'A2 FAILED: restaurants visible = [%], expected only branch A', leaked;
    END IF;
  END $$;
  RESET ROLE;
ROLLBACK;

-- =============================================================================
-- A3. Same connection, context switched to B => sees exactly B, never A.
-- =============================================================================
BEGIN;
  SET ROLE sufria_dashboard;
  DO $ctx$ BEGIN PERFORM set_config('app.current_restaurant_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true); END $ctx$;
  DO $$
  DECLARE n int;
  BEGIN
    SELECT count(*) INTO n FROM orders WHERE restaurant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    IF n <> 1 THEN RAISE EXCEPTION 'A3 FAILED: expected 1 order for branch B, got %', n; END IF;
    SELECT count(*) INTO n FROM orders WHERE restaurant_id <> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    IF n <> 0 THEN RAISE EXCEPTION 'A3 FAILED: branch A data visible from branch B context'; END IF;
  END $$;
  RESET ROLE;
ROLLBACK;

-- =============================================================================
-- A4. THE POOLED-CONNECTION LEAK.
--     set_config(..., is_local => true) is transaction-scoped. After the
--     transaction ends the context is gone, so the next request to borrow this
--     connection from the pool starts with zero visibility rather than
--     inheriting the previous tenant.
--     If someone "fixes a bug" by switching to plain SET, this assertion is the
--     thing that catches it.
-- =============================================================================
BEGIN;
  SET ROLE sufria_dashboard;
  DO $ctx$ BEGIN PERFORM set_config('app.current_restaurant_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true); END $ctx$;
  RESET ROLE;
COMMIT;

BEGIN;
  SET ROLE sufria_dashboard;
  DO $$
  DECLARE n int;
  BEGIN
    SELECT count(*) INTO n FROM orders;
    IF n <> 0 THEN
      RAISE EXCEPTION 'A4 FAILED: tenant context survived the transaction — % rows visible on a recycled connection. This is a cross-tenant read.', n;
    END IF;
  END $$;
  RESET ROLE;
ROLLBACK;

-- =============================================================================
-- A5. WITH CHECK — cannot write a row into another tenant.
-- =============================================================================
BEGIN;
  SET ROLE sufria_dashboard;
  DO $ctx$ BEGIN PERFORM set_config('app.current_restaurant_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true); END $ctx$;
  DO $$
  BEGIN
    BEGIN
      INSERT INTO menu_categories (restaurant_id, name)
      VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'تصنيف مهرّب');
      RAISE EXCEPTION 'A5 FAILED: inserted a row into a foreign tenant';
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;  -- expected: new row violates row-level security policy
    END;
  END $$;
  RESET ROLE;
ROLLBACK;

-- =============================================================================
-- A6. Cannot MOVE an owned row to another tenant via UPDATE.
-- =============================================================================
BEGIN;
  SET ROLE sufria_dashboard;
  DO $ctx$ BEGIN PERFORM set_config('app.current_restaurant_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true); END $ctx$;
  DO $$
  BEGIN
    BEGIN
      UPDATE menu_categories
         SET restaurant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
       WHERE restaurant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      RAISE EXCEPTION 'A6 FAILED: moved a row to a foreign tenant via UPDATE';
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
  END $$;
  RESET ROLE;
ROLLBACK;

-- =============================================================================
-- A7. Cannot DELETE another tenant's rows (silently affects 0 rows, not theirs).
-- =============================================================================
BEGIN;
  SET ROLE sufria_dashboard;
  DO $ctx$ BEGIN PERFORM set_config('app.current_restaurant_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true); END $ctx$;
  DO $$
  DECLARE n int;
  BEGIN
    DELETE FROM menu_items WHERE restaurant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'A7 FAILED: deleted % rows belonging to another tenant', n; END IF;
  END $$;
  RESET ROLE;
ROLLBACK;

-- =============================================================================
-- A8. The denormalised child tables are isolated too.
--     order_items and order_status_history carry their own restaurant_id
--     (ADR-002). This asserts the denormalisation did not open a hole.
-- =============================================================================
BEGIN;
  SET ROLE sufria_dashboard;
  DO $ctx$ BEGIN PERFORM set_config('app.current_restaurant_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true); END $ctx$;
  DO $$
  DECLARE n int;
  BEGIN
    SELECT count(*) INTO n FROM order_items;
    IF n <> 1 THEN RAISE EXCEPTION 'A8 FAILED: expected 1 order_item, got %', n; END IF;
    SELECT count(*) INTO n FROM order_status_history;
    IF n <> 1 THEN RAISE EXCEPTION 'A8 FAILED: expected 1 history row, got %', n; END IF;
    -- and specifically not branch B's
    SELECT count(*) INTO n FROM order_items WHERE item_name_snapshot = 'شاورما لحمة';
    IF n <> 0 THEN RAISE EXCEPTION 'A8 FAILED: sibling-branch order_item leaked'; END IF;
  END $$;
  RESET ROLE;
ROLLBACK;

-- =============================================================================
-- A9. A forged / non-member context yields nothing.
--     Even if an attacker controls the id placed in the context, RLS shows them
--     only that tenant — which is why the Guard MUST run first. This asserts the
--     second half: an unknown id is not a wildcard.
-- =============================================================================
BEGIN;
  SET ROLE sufria_dashboard;
  DO $ctx$ BEGIN PERFORM set_config('app.current_restaurant_id', '99999999-9999-4999-8999-999999999999', true); END $ctx$;
  DO $$
  DECLARE n int;
  BEGIN
    SELECT count(*) INTO n FROM orders;
    IF n <> 0 THEN RAISE EXCEPTION 'A9 FAILED: unknown tenant id returned % rows', n; END IF;
  END $$;
  RESET ROLE;
ROLLBACK;

-- =============================================================================
-- A10. A malformed context must not become a wildcard.
--      Empty string is the realistic case: an unset env var or a null coalesced
--      to ''. NULLIF in app.current_restaurant() turns it into NULL -> no rows.
-- =============================================================================
BEGIN;
  SET ROLE sufria_dashboard;
  DO $ctx$ BEGIN PERFORM set_config('app.current_restaurant_id', '', true); END $ctx$;
  DO $$
  DECLARE n int;
  BEGIN
    SELECT count(*) INTO n FROM orders;
    IF n <> 0 THEN RAISE EXCEPTION 'A10 FAILED: empty context returned % rows', n; END IF;
  END $$;
  RESET ROLE;
ROLLBACK;

-- =============================================================================
-- A11. app.verify_membership — the Guard's only privileged call.
--      Must be true for both branches for staff #1, false for a non-member,
--      false for an inactive membership.
-- =============================================================================
BEGIN;
  SET ROLE sufria_dashboard;
  DO $$
  BEGIN
    IF NOT app.verify_membership('50000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') THEN
      RAISE EXCEPTION 'A11 FAILED: chain staff denied on branch A';
    END IF;
    IF NOT app.verify_membership('50000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') THEN
      RAISE EXCEPTION 'A11 FAILED: chain staff denied on branch B';
    END IF;
    -- staff #2 belongs to A only. Must be refused on B even though A and B share a chain.
    IF app.verify_membership('50000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') THEN
      RAISE EXCEPTION 'A11 FAILED: branch-A-only staff granted access to sibling branch B';
    END IF;
    -- unrelated restaurant
    IF app.verify_membership('50000000-0000-4000-8000-000000000002', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc') THEN
      RAISE EXCEPTION 'A11 FAILED: staff granted access to an unrelated restaurant';
    END IF;
  END $$;
  RESET ROLE;
ROLLBACK;

-- =============================================================================
-- A12. Deactivating a membership revokes access immediately.
-- =============================================================================
BEGIN;
  UPDATE restaurant_staff SET is_active = false
   WHERE staff_account_id = '50000000-0000-4000-8000-000000000001'
     AND restaurant_id    = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  SET ROLE sufria_dashboard;
  DO $$
  BEGIN
    IF app.verify_membership('50000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') THEN
      RAISE EXCEPTION 'A12 FAILED: deactivated membership still grants access';
    END IF;
  END $$;
  RESET ROLE;
ROLLBACK;

-- =============================================================================
-- A13. app.restaurants_with_unnotified_orders — Bypass #4 (0012), the
--      notification poller's only privileged call. The engine alone may run
--      it: not the API role, not PUBLIC. SECURITY DEFINER with a pinned
--      search_path, or a caller could shadow `orders`.
-- =============================================================================
BEGIN;
  DO $$
  DECLARE fn regprocedure := 'app.restaurants_with_unnotified_orders()'::regprocedure;
  BEGIN
    IF has_function_privilege('sufria_dashboard', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'A13 FAILED: the API role can execute restaurants_with_unnotified_orders()';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                WHERE p.oid = fn AND a.grantee = 0) THEN
      RAISE EXCEPTION 'A13 FAILED: PUBLIC can execute restaurants_with_unnotified_orders()';
    END IF;
    IF NOT has_function_privilege('sufria_engine', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'A13 FAILED: the engine role cannot execute restaurants_with_unnotified_orders()';
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = fn) THEN
      RAISE EXCEPTION 'A13 FAILED: restaurants_with_unnotified_orders() is not SECURITY DEFINER';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proconfig) c
                    WHERE p.oid = fn AND c LIKE 'search_path=%') THEN
      RAISE EXCEPTION 'A13 FAILED: restaurants_with_unnotified_orders() has no pinned search_path';
    END IF;
  END $$;
  -- And the call itself, not only the catalogue: the API role is refused.
  SET ROLE sufria_dashboard;
  DO $$
  BEGIN
    BEGIN
      PERFORM app.restaurants_with_unnotified_orders();
      RAISE EXCEPTION 'A13 FAILED: the API role called restaurants_with_unnotified_orders()';
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;  -- expected: permission denied for function
    END;
  END $$;
  RESET ROLE;
ROLLBACK;

-- =============================================================================
-- A14. A restaurant whose orders are all notified = true does not appear.
--      Set up explicitly inside the transaction, so rows other suites leave
--      behind cannot make it pass: every order notified, then branch B's one
--      order put back to notified = false.
-- =============================================================================
BEGIN;
  UPDATE orders SET notified = true;
  UPDATE orders SET notified = false
   WHERE restaurant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  SET ROLE sufria_engine;
  DO $$
  DECLARE got text;
  BEGIN
    SELECT string_agg(r::text, ',' ORDER BY r) INTO got
      FROM app.restaurants_with_unnotified_orders() r;
    IF got IS DISTINCT FROM 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' THEN
      RAISE EXCEPTION 'A14 FAILED: expected only branch B, got [%]', got;
    END IF;
  END $$;
  RESET ROLE;
  -- Nothing unnotified anywhere => nothing at all.
  UPDATE orders SET notified = true;
  SET ROLE sufria_engine;
  DO $$
  DECLARE n int;
  BEGIN
    SELECT count(*) INTO n FROM app.restaurants_with_unnotified_orders();
    IF n <> 0 THEN
      RAISE EXCEPTION 'A14 FAILED: % restaurants returned with every order notified', n;
    END IF;
  END $$;
  RESET ROLE;
ROLLBACK;

-- =============================================================================
-- A15. The function returns no order data. The declared result is a bare
--      SETOF uuid (no OUT columns to widen later without this failing), and
--      every value it returns is a restaurant id — never an order id.
-- =============================================================================
BEGIN;
  DO $$
  DECLARE result text;
  BEGIN
    SELECT pg_get_function_result('app.restaurants_with_unnotified_orders()'::regprocedure)
      INTO result;
    IF result <> 'SETOF uuid' THEN
      RAISE EXCEPTION 'A15 FAILED: result type is [%], must be exactly SETOF uuid', result;
    END IF;
  END $$;
  UPDATE orders SET notified = false;
  SET ROLE sufria_engine;
  DO $$
  DECLARE total int;
  BEGIN
    SELECT count(*) INTO total FROM app.restaurants_with_unnotified_orders();
    IF total = 0 THEN
      RAISE EXCEPTION 'A15 FAILED: nothing returned — the check below would be vacuous';
    END IF;
  END $$;
  RESET ROLE;
  -- Compared as the owner: the engine cannot see orders to compare against.
  CREATE TEMP TABLE a15_returned ON COMMIT DROP AS
    SELECT r AS id FROM app.restaurants_with_unnotified_orders() r;
  DO $$
  DECLARE n int;
  BEGIN
    SELECT count(*) INTO n FROM a15_returned x JOIN orders o ON o.id = x.id;
    IF n <> 0 THEN RAISE EXCEPTION 'A15 FAILED: % order ids returned', n; END IF;
    SELECT count(*) INTO n FROM a15_returned x
     WHERE NOT EXISTS (SELECT 1 FROM restaurants r WHERE r.id = x.id);
    IF n <> 0 THEN RAISE EXCEPTION 'A15 FAILED: % values that are not restaurant ids', n; END IF;
  END $$;
ROLLBACK;

DO $$ BEGIN RAISE NOTICE 'ALL 15 ASSERTIONS PASSED — chain isolation gate is green'; END $$;
