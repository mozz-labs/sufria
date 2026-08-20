-- =============================================================================
-- كلمات سر أدوار التطوير — للتطوير المحلي فقط. أبدا على الإنتاج.
--
-- ليش هذا الملف موجود:
--   0003_roles_and_rls.sql بيعمل CREATE ROLE wafa_dashboard LOGIN — بلا كلمة سر.
--   و .env.example بيتوقع  postgres://wafa_dashboard:devpass@localhost:5432/wafa
--   يعني الاتصال بيفشل بـ"password authentication failed" أول ما حدا يشغّل
--   التطبيق فعليا (pnpm dev) — رغم إن كل الفحوصات خضرا.
--
--   ما انكشفت لحد ١٧ أغسطس ٢٠٢٦ لأن الـCI بيستخدم دور postgres لكل شي،
--   والبوابة الأمنية بتعمل SET ROLE جوا الـSQL — فما حدا احتاج كلمة سر أبدا.
--
-- ليش بالـseed مش بـmigration:
--   الـmigrations بتمشي على الإنتاج كمان. كلمة سر تطوير ما بتنحط بملف
--   بيتنفّذ على الإنتاج. الـseed تطويري بطبيعته ومحمي بفحص NODE_ENV.
-- =============================================================================

ALTER ROLE wafa_dashboard PASSWORD 'devpass';
ALTER ROLE wafa_engine    PASSWORD 'devpass';
