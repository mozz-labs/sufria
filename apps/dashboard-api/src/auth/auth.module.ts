import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { env } from "../config/env.js";
import { DbModule } from "../db/db.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { RestaurantContextGuard } from "./restaurant-context.guard.js";

@Module({
  imports: [
    DbModule,
    JwtModule.register({
      global: true,
      secret: env().JWT_SECRET,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, RestaurantContextGuard],
  exports: [AuthService, RestaurantContextGuard],
})
export class AuthModule {}
