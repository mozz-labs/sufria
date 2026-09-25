import { ConversationService } from "./conversation/session.service.js";
import { env } from "./config/env.js";
import { TenantDb } from "./db/tenant-db.js";
import { createWebhookServer, WEBHOOK_PATH } from "./http/server.js";
import { logger } from "./logger.js";
import { OrderNotifier } from "./notify/order-notifier.js";
import { MetaWhatsAppSender } from "./whatsapp/sender.js";
import { WebhookService } from "./whatsapp/webhook.service.js";

async function bootstrap(): Promise<void> {
  // بيرمي الآن لو أي متغيّر بيئة ناقص — قبل ما ينفتح أي منفذ.
  const config = env();

  const db = new TenantDb();
  // بيرفض الإقلاع لو الاتصال كـsuperuser. قبل المنفذ كمان.
  await db.start();

  // 🔴 المسار الوحيد للإنتاج. RecordingWhatsAppSender بـwhatsapp/sender.ts
  //    موجود للاختبارات وللتشغيل المحلي بلا توكن، وما بينوصل من هون أبدا.
  const sender = new MetaWhatsAppSender();
  const conversation = new ConversationService(sender);
  // مُراقِب الإشعارات (FR-11): نفس المرسِل ونفس المخزن. `NOTIFY_POLL_MS=0` يطفئه.
  const notifier = new OrderNotifier(db, sender, {
    pollMs: config.NOTIFY_POLL_MS,
  });

  const server = createWebhookServer({
    service: new WebhookService(db, conversation),
    health: db,
    verifyToken: config.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    appSecret: config.WHATSAPP_APP_SECRET,
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "إيقاف محرّك المحادثة");
    server.close(() => {
      // المُراقِب قبل المخزن: بيستنّى دورته الشغّالة، فما بينسكّر المخزن تحتها.
      void notifier
        .stop()
        .then(() => db.stop())
        .then(() => process.exit(0));
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  server.listen(config.ENGINE_PORT, () => {
    logger.info(
      { port: config.ENGINE_PORT, path: WEBHOOK_PATH },
      "محرّك المحادثة يستمع",
    );
    notifier.start();
    logger.info(
      { pollMs: config.NOTIFY_POLL_MS },
      config.NOTIFY_POLL_MS === 0
        ? "مُراقِب الإشعارات مطفأ (NOTIFY_POLL_MS=0)"
        : "مُراقِب الإشعارات يعمل",
    );
  });
}

void bootstrap().catch((error: unknown) => {
  logger.error({ err: error }, "فشل إقلاع محرّك المحادثة");
  process.exit(1);
});
