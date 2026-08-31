-- =============================================================================
-- Development passwords for the fixture staff accounts. NEVER on production.
--
-- chain-isolation-fixture.sql stores 'x' as the password hash because the
-- isolation gate never authenticates — it uses SET ROLE. Once /auth/login
-- exists, those accounts need a hash that argon2 can actually verify.
--
-- All three accounts share the password:  sufria1234
-- The hash below is argon2id (m=65536, t=3, p=4) and carries its own salt.
-- =============================================================================

UPDATE staff_accounts
SET password_hash = '$argon2id$v=19$m=65536,p=4,t=3$c6DG+QAOdtg7qdFpDqNUQw$cdFhJrF76Gfafo8O9xLFffqyHVeqAdE8hp+oY+vUsB0'
WHERE phone_or_email IN ('both@sufria.test', 'onlya@sufria.test', 'onlyz@sufria.test');
