-- =============================================================================
-- 0005 — Bypass #3: the login membership list (S0-08)
--
-- The problem this solves, precisely:
--   /auth/login must answer "which restaurants does this account belong to?"
--   That answer lives in restaurant_staff — a table whose RLS policy is keyed
--   on app.current_restaurant(). At login there is no restaurant context yet
--   (that is the whole point of logging in), so the app role reads zero rows
--   and every login fails with "بيانات الدخول غير صحيحة".
--
--   Same shape as Bypass #1 (verify_membership): a question that must be
--   answered BEFORE tenant context exists, therefore answered by a narrow
--   SECURITY DEFINER function rather than by loosening any policy.
--
-- The privileged surface, kept as small as it can be:
--   - Input is ONE staff_account_id. The caller has just proven possession of
--     that account's password; it returns nothing about any other account.
--   - Output is four columns and no more: restaurant id, name, location, role.
--     No whatsapp ids, no commission rates, no subscription state.
--   - Inactive memberships, inactive accounts and suspended restaurants are
--     filtered here, so a disabled member cannot log in and see a branch list.
--
-- SET search_path is not decoration. A SECURITY DEFINER function without it
-- runs with the caller's search_path, and a caller who can create a schema can
-- shadow `restaurant_staff` with their own table and have this function read it.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION app.restaurants_for_staff(p_staff_account_id uuid)
  RETURNS TABLE (id uuid, name text, location text, role text)
  LANGUAGE sql SECURITY DEFINER STABLE
  SET search_path = public, pg_temp
  AS $$
    SELECT r.id, r.name, r.location, rs.role::text
    FROM restaurant_staff rs
    JOIN staff_accounts   sa ON sa.id = rs.staff_account_id
    JOIN restaurants      r  ON r.id  = rs.restaurant_id
    WHERE rs.staff_account_id = p_staff_account_id
      AND rs.is_active
      AND sa.is_active
      AND r.status <> 'suspended'
    ORDER BY r.name
  $$;

REVOKE ALL ON FUNCTION app.restaurants_for_staff(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.restaurants_for_staff(uuid) TO wafa_dashboard;

COMMIT;
