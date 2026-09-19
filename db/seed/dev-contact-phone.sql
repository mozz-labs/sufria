-- =============================================================================
-- Development contact phone for the handoff message. NEVER on production.
--
-- Without it, contact_phone is NULL everywhere in development, so the NULL
-- branch (handoff sends nothing) is the only one that ever runs by hand, and
-- the branch that actually prints a number ships without being exercised once.
--
-- Only restaurant A (فرع الشميساني) gets a number. B and Z stay NULL on
-- purpose, so a development database carries both branches side by side.
--
-- A separate file on the dev-staff-passwords.sql pattern, not an edit to
-- chain-isolation-fixture.sql: that fixture exists for the security gate and
-- stays shaped for it alone.
-- =============================================================================

UPDATE restaurants
SET contact_phone = '0790000099'
WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
