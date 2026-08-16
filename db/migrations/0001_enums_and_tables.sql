-- =============================================================================
-- Wafa — Migration 0001: Extensions, Enums, Tables
-- Sprint 0. Source of truth: Blueprint §5.7 + SRS v1.1 (FR-01..FR-21, NFR-01..12)
--
-- IMPORTANT: raw SQL, not ORM-generated. RLS policies, FORCE ROW LEVEL SECURITY,
-- partial indexes and SECURITY DEFINER functions cannot be expressed in either
-- Prisma's or Drizzle's schema DSL. Migrations are hand-written and reviewed;
-- the ORM only reads the resulting schema.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive login identifier

-- -----------------------------------------------------------------------------
-- Enums. Declared complete up front (Blueprint §5.7: "enum نهائي كامل").
-- Adding a value later is cheap; changing semantics later is not.
-- -----------------------------------------------------------------------------

CREATE TYPE restaurant_status        AS ENUM ('trial', 'active', 'suspended');
CREATE TYPE wa_verification_status   AS ENUM ('pending_verification', 'verified', 'rejected');
CREATE TYPE staff_role               AS ENUM ('owner', 'manager', 'staff');

CREATE TYPE conversation_state       AS ENUM (
  'new', 'browsing', 'cart_review', 'fulfillment_choice',
  'awaiting_payment', 'order_placed', 'abandoned'
);

CREATE TYPE order_status             AS ENUM (
  'pending_acceptance', 'accepted', 'preparing', 'ready',
  'completed', 'cancelled', 'expired'
);

CREATE TYPE payment_status           AS ENUM (
  'pending_cash', 'pending_online', 'paid', 'collected', 'refunded'
);

CREATE TYPE payment_method           AS ENUM ('online', 'cash');
CREATE TYPE fulfillment_type         AS ENUM ('pickup', 'delivery');
CREATE TYPE cancelled_by             AS ENUM ('customer', 'restaurant', 'system');
CREATE TYPE actor_kind               AS ENUM ('staff', 'customer', 'system');
CREATE TYPE webhook_source           AS ENUM ('whatsapp', 'payment_gateway');
CREATE TYPE subscription_status      AS ENUM ('trial', 'active', 'past_due', 'cancelled');
CREATE TYPE customer_channel         AS ENUM ('whatsapp');  -- Decision #5: channel column exists now, values grow later

-- -----------------------------------------------------------------------------
-- staff_accounts
-- NOT restaurant-scoped by design: one login may hold membership in several
-- restaurants of the same chain (SRS NFR-02, Decision #7). Therefore this table
-- carries NO RLS policy — it is read during login, before any restaurant context
-- exists. It is protected at the application layer only. See 0004_roles_and_rls.
-- -----------------------------------------------------------------------------
CREATE TABLE staff_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_or_email  citext NOT NULL UNIQUE,
  password_hash   text   NOT NULL,
  name            text   NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- restaurants
-- -----------------------------------------------------------------------------
CREATE TABLE restaurants (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id                    uuid NULL,                    -- Decision #7: data model now, switcher UI deferred
  name                        text NOT NULL,
  logo_url                    text NULL,
  location                    text NULL,
  business_hours              jsonb NOT NULL DEFAULT '{}'::jsonb,

  whatsapp_number             text NULL,
  whatsapp_phone_id           text NULL UNIQUE,             -- Meta phone_number_id; inbound webhook routes on this
  whatsapp_verification_status wa_verification_status NOT NULL DEFAULT 'pending_verification',

  accepts_online_payment      boolean NOT NULL DEFAULT false,
  accepts_cash_on_delivery    boolean NOT NULL DEFAULT true,
  offers_delivery             boolean NOT NULL DEFAULT false,

  assumed_commission_rate     numeric(5,4) NOT NULL DEFAULT 0.2500
                                CHECK (assumed_commission_rate >= 0 AND assumed_commission_rate <= 1),

  status                      restaurant_status NOT NULL DEFAULT 'trial',
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- restaurant_staff — the membership table the authorization Guard reads.
-- This is the single most security-critical table in the system.
-- -----------------------------------------------------------------------------
CREATE TABLE restaurant_staff (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_account_id  uuid NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,
  restaurant_id     uuid NOT NULL REFERENCES restaurants(id)    ON DELETE CASCADE,
  role              staff_role NOT NULL DEFAULT 'staff',
  permissions       jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_account_id, restaurant_id)
);

-- -----------------------------------------------------------------------------
-- menu
-- -----------------------------------------------------------------------------
CREATE TABLE menu_categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE menu_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category_id   uuid NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text NULL,
  price         numeric(12,2) NOT NULL CHECK (price >= 0),   -- NFR-09: validated before storage
  image_url     text NULL,
  is_available  boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  tags          jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- A category always belongs to the same restaurant as its items.
-- Enforced structurally, not by application discipline.
ALTER TABLE menu_categories ADD CONSTRAINT menu_categories_tenant_key UNIQUE (id, restaurant_id);
ALTER TABLE menu_items
  ADD CONSTRAINT menu_items_category_same_restaurant
  FOREIGN KEY (category_id, restaurant_id)
  REFERENCES menu_categories (id, restaurant_id) ON DELETE CASCADE;

-- -----------------------------------------------------------------------------
-- customers
-- -----------------------------------------------------------------------------
CREATE TABLE customers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  phone_number  text NOT NULL,
  name          text NULL,
  channel       customer_channel NOT NULL DEFAULT 'whatsapp',
  total_orders  integer NOT NULL DEFAULT 0 CHECK (total_orders >= 0),
  total_spend   numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_spend >= 0),
  last_order_at timestamptz NULL,
  is_vip        boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, phone_number)
);

-- -----------------------------------------------------------------------------
-- conversation_sessions
-- -----------------------------------------------------------------------------
CREATE TABLE conversation_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  customer_id     uuid NOT NULL REFERENCES customers(id)   ON DELETE CASCADE,
  state           conversation_state NOT NULL DEFAULT 'new',
  context         jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- orders
--
-- Two deliberate additions beyond Blueprint §5.7, both to keep the two scheduler
-- jobs off order_status_history. Rationale in docs/ADR-002-denormalisation.md:
--   ready_at        — drives the 24h pickup expiry (§5.6). Reading it from
--                     order_status_history would mean a correlated scan of an
--                     append-only table every 30 seconds.
--   outbound_msg_count — drives per-order WhatsApp cost measurement. From
--                     2026-10-01 every outbound message is billable; this is the
--                     number the subscription price has to be set against.
-- -----------------------------------------------------------------------------
CREATE TABLE orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  customer_id         uuid NOT NULL REFERENCES customers(id)   ON DELETE RESTRICT,
  session_id          uuid NULL REFERENCES conversation_sessions(id) ON DELETE SET NULL,

  fulfillment_type    fulfillment_type NOT NULL,
  payment_method      payment_method   NOT NULL,          -- one-way mutable: online -> cash only
  status              order_status     NOT NULL DEFAULT 'pending_acceptance',
  payment_status      payment_status   NOT NULL,

  cancelled_by        cancelled_by NULL,
  cancellation_reason text NULL,                           -- free text (staff) | fixed code (system)

  notified            boolean NOT NULL DEFAULT false,

  subtotal            numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  total               numeric(12,2) NOT NULL CHECK (total    >= 0),
  payment_link_url    text NULL,
  payment_gateway_ref text NULL UNIQUE,

  ready_at            timestamptz NULL,                    -- set on entry to 'ready'; drives 24h expiry
  outbound_msg_count  integer NOT NULL DEFAULT 0,          -- WhatsApp cost instrumentation

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- NFR-09: a completed order's payment_status is always exactly 'paid' or 'collected'.
  CONSTRAINT orders_completed_payment_settled CHECK (
    status <> 'completed' OR payment_status IN ('paid', 'collected')
  ),
  -- 'collected' is a cash-only terminal state; 'paid' can only arise from an online payment.
  CONSTRAINT orders_collected_is_cash CHECK (
    payment_status <> 'collected' OR payment_method = 'cash'
  ),
  -- cancelled_by is set if and only if the order is cancelled.
  CONSTRAINT orders_cancelled_by_consistent CHECK (
    (status = 'cancelled') = (cancelled_by IS NOT NULL)
  ),
  -- ready_at is set if and only if the order has actually reached 'ready'.
  CONSTRAINT orders_ready_at_consistent CHECK (
    ready_at IS NULL OR status IN ('ready', 'completed', 'cancelled', 'expired')
  ),
  -- 'expired' is reachable only for pickup orders (§5.6: 24h unclaimed pickup).
  CONSTRAINT orders_expired_is_pickup CHECK (
    status <> 'expired' OR fulfillment_type = 'pickup'
  )
);

-- -----------------------------------------------------------------------------
-- order_items / order_status_history
--
-- restaurant_id is denormalised onto both. Blueprint §5.7 has neither.
-- Reason: without it, every RLS policy on these tables becomes a correlated
-- EXISTS subquery against orders, evaluated per row, on the two tables that grow
-- fastest (NFR-06: 10,000 orders per restaurant). With it, the policy is an
-- index-backed equality check. Consistency is enforced by composite FK below,
-- not by application discipline.
-- -----------------------------------------------------------------------------
ALTER TABLE orders ADD CONSTRAINT orders_tenant_key UNIQUE (id, restaurant_id);

CREATE TABLE order_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL,
  restaurant_id       uuid NOT NULL,
  menu_item_id        uuid NULL REFERENCES menu_items(id) ON DELETE SET NULL,
  item_name_snapshot  text NOT NULL,
  unit_price_snapshot numeric(12,2) NOT NULL CHECK (unit_price_snapshot >= 0),
  quantity            integer NOT NULL CHECK (quantity > 0),
  notes               text NULL,
  FOREIGN KEY (order_id, restaurant_id) REFERENCES orders (id, restaurant_id) ON DELETE CASCADE
);

CREATE TABLE order_status_history (
  id            bigserial PRIMARY KEY,
  order_id      uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  from_status   order_status NULL,
  to_status     order_status NOT NULL,
  actor         actor_kind NOT NULL,
  actor_staff_id uuid NULL REFERENCES staff_accounts(id) ON DELETE SET NULL,
  reason        text NULL,
  changed_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (order_id, restaurant_id) REFERENCES orders (id, restaurant_id) ON DELETE CASCADE,
  -- actor_staff_id is present exactly when the actor is staff (NFR-09 audit trail).
  CONSTRAINT osh_actor_staff_consistent CHECK ((actor = 'staff') = (actor_staff_id IS NOT NULL))
);

-- -----------------------------------------------------------------------------
-- processed_webhook_events — the unified dedup gate (Blueprint §5.6, diagram 6.3)
-- Deliberately NOT restaurant-scoped: it is checked before any restaurant context
-- is resolved, including on the very first message of a brand-new conversation.
-- -----------------------------------------------------------------------------
CREATE TABLE processed_webhook_events (
  id           bigserial PRIMARY KEY,
  event_id     text NOT NULL,                  -- whatsapp: message_id | gateway: gateway_ref||':'||event_type
  source       webhook_source NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, source)
);

-- -----------------------------------------------------------------------------
-- subscriptions / message_templates
-- -----------------------------------------------------------------------------
CREATE TABLE subscriptions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id        uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  plan_name            text NOT NULL,
  monthly_price        numeric(12,2) NOT NULL CHECK (monthly_price >= 0),
  currency             char(3) NOT NULL DEFAULT 'JOD',
  status               subscription_status NOT NULL DEFAULT 'trial',
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end   timestamptz NULL,
  payment_method_ref   text NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE message_templates (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id          uuid NULL REFERENCES restaurants(id) ON DELETE CASCADE,  -- NULL = platform default
  template_type          text NOT NULL,
  whatsapp_template_name text NOT NULL,
  language_code          text NOT NULL DEFAULT 'ar',
  body                   text NULL,
  approval_status        text NOT NULL DEFAULT 'pending',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, template_type)
);

COMMIT;
