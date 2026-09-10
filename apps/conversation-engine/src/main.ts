import { env } from "./config/env.js";
import { TenantDb } from "./db/tenant-db.js";
import { createWebhookServer } from "./http/server.js";
import { logger } from "./logger.js";
import { WebhookService } from "./whatsapp/webhook.service.js";

async function bootstrap(): Promise<void> {
  // بيرمي الآن لو أي متغيّر بيئة ناقص — قبل ما ينفتح أي منفذ.
  const config = env();

  const db = new TenantDb();
  // بيرفض الإقلاع لو الاتصال كـsuperuser. قبل المنفذ كمان.
  await db.start();

  const server = createWebhookServer({
    service: new WebhookService(db),
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
      { port: config.ENGINE_PORT },
      "محرّك المحادثة يستمع — POST /webhook",
    );
  });
}

void bootstrap().catch((error: unknown) => {
  logger.error({ err: error }, "فشل إقلاع محرّك المحادثة");
  process.exit(1);
});
