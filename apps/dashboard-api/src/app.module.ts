import { Module } from "@nestjs/common";
import { APP_GUARD, APP_PIPE } from "@nestjs/core";
import { ZodValidationPipe } from "nestjs-zod";
import { AuthModule } from "./auth/auth.module.js";
import { JwtAuthGuard } from "./auth/guards/jwt-auth.guard.js";
import { DbModule } from "./db/db.module.js";
import { HealthController } from "./health/health.controller.js";

@Module({
  imports: [DbModule, AuthModule],
  controllers: [HealthController],
  providers: [
    // التحقق من المدخلات بـZod على مستوى التطبيق كله (ADR-003 §3).
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    // 🔴 محمي افتراضيا. الفتح لازم ينكتب صراحة بـ@Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
