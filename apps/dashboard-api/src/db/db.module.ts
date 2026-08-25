import { Global, Module } from "@nestjs/common";
import { TenantDbService } from "./tenant-db.service.js";

/**
 * عام (Global) عمدا: TenantDbService لازم يكون نسخة وحدة بكل التطبيق،
 * لأنه بيملك مخزن الاتصالات. نسختين = مخزنين = ضعف الاتصالات على القاعدة.
 */
@Global()
@Module({
  providers: [TenantDbService],
  exports: [TenantDbService],
})
export class DbModule {}
