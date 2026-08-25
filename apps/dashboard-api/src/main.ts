import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { env } from "./config/env.js";

async function bootstrap(): Promise<void> {
  // بيرمي الآن لو أي متغيّر بيئة ناقص — قبل ما ينفتح أي منفذ.
  const config = env();

  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // الفرونت اند بيشتغل على منفذ تاني بالتطوير.
  app.enableCors({
    origin: process.env.DASHBOARD_WEB_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  });

  app.enableShutdownHooks();

  await app.listen(config.DASHBOARD_API_PORT);
  new Logger("bootstrap").log(
    `dashboard-api يستمع على المنفذ ${config.DASHBOARD_API_PORT}`,
  );
}

void bootstrap();
