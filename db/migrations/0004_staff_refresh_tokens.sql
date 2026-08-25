-- =============================================================================
-- 0004 — refresh-token storage on staff_accounts (S0-08)
--
-- Why the hash and not the token: a stolen database must not hand the attacker
-- usable sessions. Verifying a presented token against a stored hash also gives
-- server-side revocation, which a stateless JWT cannot offer — logout has to
-- invalidate something, and this is that something.
--
-- One row per account = one active session per account. That is deliberate for
-- Sprint 0: a second login ends the first. Multi-device needs its own table and
-- is not in scope until someone asks for it.
--
-- staff_accounts carries no RLS by design (see 0001) — it is read during login,
-- before any restaurant context exists. These columns inherit that.
-- =============================================================================

BEGIN;

ALTER TABLE staff_accounts
  ADD COLUMN IF NOT EXISTS refresh_token_hash       text        NULL,
  ADD COLUMN IF NOT EXISTS refresh_token_expires_at timestamptz NULL;

COMMENT ON COLUMN staff_accounts.refresh_token_hash IS
  'argon2id hash of the current refresh token. NULL = signed out.';

COMMIT;
