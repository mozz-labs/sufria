-- =============================================================================
-- Development delivery settings. NEVER on production.
--
-- 0010 gives every restaurant offers_delivery = false and delivery_fee = 0, so
-- without this file no restaurant in a development database delivers at all —
-- and the entire delivery branch (the pickup-or-delivery question, the address
-- step, the fee line in the summary) can never be reached by hand or by test.
--
-- Only restaurant A (فرع الشميساني) delivers. B and Z stay pickup-only on
-- purpose, so one development database carries both branches side by side and
-- "the restaurant does not deliver" is a case that actually gets exercised.
-- Same shape as dev-contact-phone.sql, and for the same reason.
--
-- 1.50 is a plausible Amman delivery fee, not a real one. The pilot restaurant
-- gives its own — brief §7.
--
-- A separate file rather than an edit to chain-isolation-fixture.sql: that
-- fixture exists for the security gate and stays shaped for it alone
-- (cart brief §14.2).
-- =============================================================================

UPDATE restaurants
SET offers_delivery = true,
    delivery_fee    = 1.50
WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
