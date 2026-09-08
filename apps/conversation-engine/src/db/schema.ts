/**
 * مرآة Drizzle لجدول inbound_messages (هجرة 0006).
 *
 * ليش هون مش بـpackages/shared زي باقي الجداول: الجدول بيتكتب من محرّك المحادثة
 * وبس، وما في مستهلك تاني إله لحد الآن. أول ما الداشبورد يحتاج يقرأ سجل
 * المحادثة (FR-19) بينتقل التعريف لـ@sufria/shared وبينحذف من هون.
 *
 * نفس قاعدة packages/shared/src/schema.ts بتنطبق حرفيا: db/migrations/*.sql هي
 * المصدر، وهذا الملف مرآة بتتحدّث باليد. ممنوع drizzle-kit generate — بيرمي
 * سياسة RLS والـUNIQUE وما بيقول.
 */
import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { restaurants } from "@sufria/shared";

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
