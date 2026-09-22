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
  index,
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
  // 0004 — one active session per account. NULL = signed out.
  refreshTokenHash: text("refresh_token_hash"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
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
  // 0008 — the restaurant's IANA timezone. Lived inside the business_hours
  // jsonb until 0008 moved it out; that jsonb now carries only {days:{...}}.
  timezone: text("timezone").notNull().default("Asia/Amman"),
  businessHours: jsonb("business_hours").notNull().default({}),
  whatsappNumber: text("whatsapp_number"),
  // 0009 — the human number the handoff message gives a stuck customer.
  // NULL by decision means the handoff sends nothing. Not whatsappNumber:
  // that is the number the customer is already messaging.
  contactPhone: text("contact_phone"),
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
  // 0010 — what this restaurant currently charges to deliver. offersDelivery is
  // the capability, this is its price, and orders.deliveryFee is the promise the
  // customer was actually shown. 0 is a real value: delivery, free.
  deliveryFee: numeric("delivery_fee", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  // 0011 — what the restaurant sells in. The enum here is a TypeScript type
  // only; CHECK (currency IN ('JOD','ILS')) in SQL is what enforces it. The
  // labels every amount carries are CURRENCY_LABEL_AR in domain.ts.
  currency: text("currency", { enum: ["JOD", "ILS"] })
    .notNull()
    .default("JOD"),
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
  // 0011 — per restaurant from 101, UNIQUE (restaurant_id, order_number) in SQL.
  // No default on purpose: the engine allocates it under an advisory lock.
  orderNumber: integer("order_number").notNull(),
  fulfillmentType: fulfillmentType("fulfillment_type").notNull(),
  paymentMethod: paymentMethod("payment_method").notNull(),
  status: orderStatus("status").notNull().default("pending_acceptance"),
  paymentStatus: paymentStatus("payment_status").notNull(),
  cancelledBy: cancelledBy("cancelled_by"),
  cancellationReason: text("cancellation_reason"),
  notified: boolean("notified").notNull().default(false),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
  // 0010 — snapshotted from restaurants.delivery_fee when the customer chose
  // delivery, so a fee raised mid-conversation never changes an order already
  // summarised. Always 0 for pickup, and the database enforces that.
  deliveryFee: numeric("delivery_fee", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  // 0010 — the customer's own words, edges trimmed and nothing else: a driver
  // reads this. NULL for pickup, and 1..300 characters for delivery, both by
  // CHECK constraint.
  deliveryAddress: text("delivery_address"),
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

/**
 * 0006 — inbound WhatsApp messages.
 *
 * This mirror lived in `apps/conversation-engine/src/db/schema.ts` until it was
 * moved here. The engine is still the only writer, so the move is not about a
 * second consumer: `tests/db/schema-drift.verify.ts` iterates the tables
 * exported from *this* file and nothing else, so a mirror parked in an app is a
 * mirror no drift check can see. `inbound_messages` was the one table whose SQL
 * and TypeScript could disagree silently.
 *
 * The `(restaurant_id, wa_message_id)` UNIQUE below is the redelivery guard that
 * 0006 relies on — Meta retries for up to 7 days, and the insert is what makes a
 * retry idempotent. It is mirrored here so a rename shows up as a type error.
 */
export const inboundMessages = pgTable(
  "inbound_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    waMessageId: text("wa_message_id").notNull(),
    phoneNumberId: text("phone_number_id").notNull(),
    fromPhone: text("from_phone").notNull(),
    messageType: text("message_type").notNull(),
    body: text("body"),
    payload: jsonb("payload").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.restaurantId, t.waMessageId),
    index("idx_inbound_messages_conversation").on(
      t.restaurantId,
      t.fromPhone,
      t.receivedAt.desc(),
    ),
  ],
);
