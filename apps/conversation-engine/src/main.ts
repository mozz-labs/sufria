import { ConversationService } from "./conversation/session.service.js";
import { env } from "./config/env.js";
import { TenantDb } from "./db/tenant-db.js";
import { createWebhookServer, WEBHOOK_PATH } from "./http/server.js";
import { logger } from "./logger.js";
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
  const conversation = new ConversationService(new MetaWhatsAppSender());

  const server = createWebhookServer({
    service: new WebhookService(db, conversation),
    health: db,
    verifyToken: config.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    appSecret: config.WHATSAPP_APP_SECRET,
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "إيقاف محرّك المحادثة");
    server.close(() => {
      void db.stop().then(() => process.exit(0));
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  server.listen(config.ENGINE_PORT, () => {
    logger.info(
      { port: config.ENGINE_PORT, path: WEBHOOK_PATH },
      "محرّك المحادثة يستمع",
    );
  });
}

void bootstrap().catch((error: unknown) => {
  logger.error({ err: error }, "فشل إقلاع محرّك المحادثة");
  process.exit(1);
});
