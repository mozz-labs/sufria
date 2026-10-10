import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { MenuCategoriesController, MenuController } from "./menu.controller.js";
import { MenuService } from "./menu.service.js";

@Module({
  imports: [AuthModule],
  controllers: [MenuController, MenuCategoriesController],
  providers: [MenuService],
})
export class MenuModule {}
