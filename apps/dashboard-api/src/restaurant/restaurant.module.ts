import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { RestaurantSettingsController } from "./restaurant-settings.controller.js";
import { RestaurantSettingsService } from "./restaurant-settings.service.js";

@Module({
  imports: [AuthModule],
  controllers: [RestaurantSettingsController],
  providers: [RestaurantSettingsService],
})
export class RestaurantModule {}
