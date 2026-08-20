/**
 * Drizzle schema — a typed MIRROR of db/migrations/*.sql, never the source of it.
 *
 * The SQL migrations are authoritative. RLS policies, FORCE ROW LEVEL SECURITY,
 * SECURITY DEFINER functions, partial indexes and CHECK constraints cannot be
 * expressed here, so generating migrations from this file would silently drop
 * every one of them. Do not run `drizzle-kit generate` against production.
 *
 * When a migration changes, update this file to match by hand and let the type
 * checker find the call sites.
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  bigserial,
  char,
  unique,
} from "drizzle-orm/pg-core";

// --- enums (must match 0001_enums_and_tables.sql exactly) -------------------
export const restaurantStatus = pgEnum("restaurant_status", [
  "trial",
  "active",
  "suspended",
]);
export const waVerificationStatus = pgEnum("wa_verification_status", [
  "pending_verification",
  "verified",
  "rejected",
]);
export const staffRole = pgEnum("staff_role", ["owner", "manager", "staff"]);
export const conversationState = pgEnum("conversation_state", [
  "new",
  "browsing",
  "cart_review",
  "fulfillment_choice",
  "awaiting_payment",
  "order_placed",
  "abandoned",
]);
export const orderStatus = pgEnum("order_status", [
  "pending_acceptance",
  "accepted",
  "preparing",
  "ready",
  "completed",
  "cancelled",
  "expired",
]);
export const paymentStatus = pgEnum("payment_status", [
  "pending_cash",
  "pending_online",
  "paid",
  "collected",
  "refunded",
]);
export const paymentMethod = pgEnum("payment_method", ["online", "cash"]);
export const fulfillmentType = pgEnum("fulfillment_type", [
  "pickup",
  "delivery",
]);
export const cancelledBy = pgEnum("cancelled_by", [
  "customer",
  "restaurant",
  "system",
]);
export const actorKind = pgEnum("actor_kind", ["staff", "customer", "system"]);
export const webhookSource = pgEnum("webhook_source", [
  "whatsapp",
  "payment_gateway",
]);
export const subscriptionStatus = pgEnum("subscription_status", [
  "trial",
  "active",
  "past_due",
  "cancelled",
]);
export const customerChannel = pgEnum("customer_channel", ["whatsapp"]);

// --- tables -----------------------------------------------------------------
export const staffAccounts = pgTable("staff_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  phoneOrEmail: text("phone_or_email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const restaurants = pgTable("restaurants", {
  id: uuid("id").primaryKey().defaultRandom(),
  chainId: uuid("chain_id"),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  location: text("location"),
  businessHours: jsonb("business_hours").notNull().default({}),
  whatsappNumber: text("whatsapp_number"),
  whatsappPhoneId: text("whatsapp_phone_id").unique(),
  whatsappVerificationStatus: waVerificationStatus(
    "whatsapp_verification_status",
  )
    .notNull()
    .default("pending_verification"),
  acceptsOnlinePayment: boolean("accepts_online_payment")
    .notNull()
    .default(false),
  acceptsCashOnDelivery: boolean("accepts_cash_on_delivery")
    .notNull()
    .default(true),
  offersDelivery: boolean("offers_delivery").notNull().default(false),
  assumedCommissionRate: numeric("assumed_commission_rate", {
    precision: 5,
    scale: 4,
  }).notNull(),
  status: restaurantStatus("status").notNull().default("trial"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const restaurantStaff = pgTable(
  "restaurant_staff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffAccountId: uuid("staff_account_id")
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "cascade" }),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    role: staffRole("role").notNull().default("staff"),
    permissions: jsonb("permissions").notNull().default({}),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.staffAccountId, t.restaurantId)],
);

export const menuCategories = pgTable("menu_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  restaurantId: uuid("restaurant_id").notNull(),
  name: text("name").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const menuItems = pgTable("menu_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  restaurantId: uuid("restaurant_id").notNull(),
  categoryId: uuid("category_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  imageUrl: text("image_url"),
  isAvailable: boolean("is_available").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  tags: jsonb("tags").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    phoneNumber: text("phone_number").notNull(),
    name: text("name"),
    channel: customerChannel("channel").notNull().default("whatsapp"),
    totalOrders: integer("total_orders").notNull().default(0),
    totalSpend: numeric("total_spend", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    lastOrderAt: timestamp("last_order_at", { withTimezone: true }),
    isVip: boolean("is_vip").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.restaurantId, t.phoneNumber)],
);

export const conversationSessions = pgTable("conversation_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  restaurantId: uuid("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  state: conversationState("state").notNull().default("new"),
  context: jsonb("context").notNull().default({}),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  restaurantId: uuid("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  sessionId: uuid("session_id").references(() => conversationSessions.id),
  fulfillmentType: fulfillmentType("fulfillment_type").notNull(),
  paymentMethod: paymentMethod("payment_method").notNull(),
  status: orderStatus("status").notNull().default("pending_acceptance"),
  paymentStatus: paymentStatus("payment_status").notNull(),
  cancelledBy: cancelledBy("cancelled_by"),
  cancellationReason: text("cancellation_reason"),
  notified: boolean("notified").notNull().default(false),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  paymentLinkUrl: text("payment_link_url"),
  paymentGatewayRef: text("payment_gateway_ref").unique(),
  readyAt: timestamp("ready_at", { withTimezone: true }), // ADR-002 §2
  outboundMsgCount: integer("outbound_msg_count").notNull().default(0), // ADR-002 §3
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull(),
  restaurantId: uuid("restaurant_id").notNull(), // ADR-002 §1 — denormalised for RLS
  menuItemId: uuid("menu_item_id"),
  itemNameSnapshot: text("item_name_snapshot").notNull(),
  unitPriceSnapshot: numeric("unit_price_snapshot", {
    precision: 12,
    scale: 2,
  }).notNull(),
  quantity: integer("quantity").notNull(),
  notes: text("notes"),
});

export const orderStatusHistory = pgTable("order_status_history", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  orderId: uuid("order_id").notNull(),
  restaurantId: uuid("restaurant_id").notNull(), // ADR-002 §1
  fromStatus: orderStatus("from_status"),
  toStatus: orderStatus("to_status").notNull(),
  actor: actorKind("actor").notNull(),
  actorStaffId: uuid("actor_staff_id").references(() => staffAccounts.id),
  reason: text("reason"),
  changedAt: timestamp("changed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const processedWebhookEvents = pgTable(
  "processed_webhook_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    eventId: text("event_id").notNull(),
    source: webhookSource("source").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.eventId, t.source)],
);

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  restaurantId: uuid("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "cascade" }),
  planName: text("plan_name").notNull(),
  monthlyPrice: numeric("monthly_price", { precision: 12, scale: 2 }).notNull(),
  currency: char("currency", { length: 3 }).notNull().default("JOD"),
  status: subscriptionStatus("status").notNull().default("trial"),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true })
    .notNull()
    .defaultNow(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  paymentMethodRef: text("payment_method_ref"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const messageTemplates = pgTable(
  "message_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    restaurantId: uuid("restaurant_id").references(() => restaurants.id, {
      onDelete: "cascade",
    }),
    templateType: text("template_type").notNull(),
    whatsappTemplateName: text("whatsapp_template_name").notNull(),
    languageCode: text("language_code").notNull().default("ar"),
    body: text("body"),
    approvalStatus: text("approval_status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.restaurantId, t.templateType)],
);
