-- =============================================================================
-- Fixture for the mandatory Sprint 0 security test.
--
-- The shape that matters: ONE staff account holding an ACTIVE membership in TWO
-- branches of the SAME chain. This is the case Blueprint §5.5 calls out as
-- mandatory, and it is the one that application-level `WHERE restaurant_id = ?`
-- filtering passes by accident and RLS catches on purpose — because here the
-- staff member is genuinely authorized for both, and the boundary that has to
-- hold is per-request, not per-user.
-- =============================================================================

BEGIN;

-- chain: 11111111-...  branches A and B belong to it. Z is unrelated.
INSERT INTO restaurants (id, chain_id, name, whatsapp_phone_id, status) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'شاورما الأصيل — فرع الشميساني', 'PHONE_A', 'active'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 'شاورما الأصيل — فرع الجاردنز',  'PHONE_B', 'active'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', NULL,                                   'مطعم غير مرتبط',                'PHONE_Z', 'active');

INSERT INTO staff_accounts (id, phone_or_email, password_hash, name) VALUES
  ('50000000-0000-4000-8000-000000000001', 'both@wafa.test',  'x', 'موظف بفرعين'),
  ('50000000-0000-4000-8000-000000000002', 'onlya@wafa.test', 'x', 'موظف فرع أ فقط'),
  ('50000000-0000-4000-8000-000000000003', 'onlyz@wafa.test', 'x', 'موظف مطعم غير مرتبط');

INSERT INTO restaurant_staff (staff_account_id, restaurant_id, role, is_active) VALUES
  ('50000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'manager', true),
  ('50000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'manager', true),
  ('50000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'staff',   true),
  ('50000000-0000-4000-8000-000000000003', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'owner',   true);

INSERT INTO customers (id, restaurant_id, phone_number, name, total_orders, total_spend) VALUES
  ('c0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '+962790000001', 'زبون فرع أ', 3, 45.00),
  ('c0000000-0000-4000-8000-00000000000b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '+962790000002', 'زبون فرع ب', 7, 120.50),
  ('c0000000-0000-4000-8000-00000000000c', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '+962790000003', 'زبون مطعم ج', 1, 10.00);

INSERT INTO menu_categories (id, restaurant_id, name) VALUES
  ('d0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'شاورما'),
  ('d0000000-0000-4000-8000-00000000000b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'شاورما');

INSERT INTO menu_items (id, restaurant_id, category_id, name, price) VALUES
  ('e0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'd0000000-0000-4000-8000-00000000000a', 'شاورما دجاج', 2.50),
  ('e0000000-0000-4000-8000-00000000000b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'd0000000-0000-4000-8000-00000000000b', 'شاورما لحمة', 3.00);

INSERT INTO orders (id, restaurant_id, customer_id, fulfillment_type, payment_method, status, payment_status, subtotal, total) VALUES
  ('f0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'c0000000-0000-4000-8000-00000000000a', 'pickup', 'cash',   'pending_acceptance', 'pending_cash',   5.00,  5.00),
  ('f0000000-0000-4000-8000-00000000000b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'c0000000-0000-4000-8000-00000000000b', 'pickup', 'online', 'pending_acceptance', 'pending_online', 12.00, 12.00),
  ('f0000000-0000-4000-8000-00000000000c', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c0000000-0000-4000-8000-00000000000c', 'pickup', 'cash',   'pending_acceptance', 'pending_cash',   10.00, 10.00);

INSERT INTO order_items (order_id, restaurant_id, menu_item_id, item_name_snapshot, unit_price_snapshot, quantity) VALUES
  ('f0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'e0000000-0000-4000-8000-00000000000a', 'شاورما دجاج', 2.50, 2),
  ('f0000000-0000-4000-8000-00000000000b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'e0000000-0000-4000-8000-00000000000b', 'شاورما لحمة', 3.00, 4);

INSERT INTO order_status_history (order_id, restaurant_id, from_status, to_status, actor) VALUES
  ('f0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', NULL, 'pending_acceptance', 'customer'),
  ('f0000000-0000-4000-8000-00000000000b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', NULL, 'pending_acceptance', 'customer');

COMMIT;
