import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from '@wafa/shared';

export type TenantTx = NodePgDatabase<typeof schema>;

/**
 * The ONLY way the Dashboard API is allowed to touch tenant data.
 *
 * The raw drizzle instance is private on purpose. If a service can reach the
 * pool directly it can run a query with no tenant context, and under RLS that
 * silently returns zero rows — which surfaces as "the dashboard is empty" in
 * production and as nothing at all in tests. Forcing every read and write
 * through runInTenant() makes the context impossible to forget.
 *
 * Three properties this class exists to guarantee:
 *
 *  1. The context is set inside the same transaction as the query. Drizzle's
 *     tx callback holds one connection for its whole duration, so the SET and
 *     the SELECT cannot land on different pool members.
 *
 *  2. is_local = true. The context dies with the transaction. A plain SET would
 *     persist on the pooled connection and be inherited by whichever request
 *     borrows it next — a cross-tenant read that no unit test will ever catch
 *     because it needs two tenants and a shared pool to reproduce.
 *
 *  3. The restaurant id is a BIND PARAMETER. `SET LOCAL x = '<id>'` cannot take
 *     one, which is exactly why set_config() is used instead: interpolating the
 *     id into SQL would put an injection point in the tenant boundary itself.
 */
@Injectable()
export class TenantDbService {
  private readonly pool: Pool;
  private readonly db: NodePgDatabase<typeof schema>;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX ?? 10),
    });
    this.db = drizzle(this.pool, { schema });
    void this.assertNotSuperuser();
  }

  /**
   * Refuses to start if DATABASE_URL points at a superuser or a BYPASSRLS role.
   *
   * Managed Postgres providers hand out an admin connection string by default,
   * and pasting it into DATABASE_URL disables every policy in 0003 without a
   * single error message. Fail loudly at boot instead of silently in production.
   */
  private async assertNotSuperuser(): Promise<void> {
    // ملاحظة: execute() تبع node-postgres بترجّع QueryResult مش مصفوفة.
    // الصفوف بـ.rows — الخلط بينهم بيعطي undefined بصمت، يعني الفحص
    // بيمر دايما وهو فعليا ما بيفحص إشي.
    const res = await this.db.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(
      sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    const row = res.rows[0];
    if (row?.rolsuper || row?.rolbypassrls) {
      throw new Error(
        'DATABASE_URL connects as a superuser or BYPASSRLS role. ' +
          'Row-Level Security is bypassed and tenant isolation is OFF. ' +
          'Use the wafa_dashboard role.',
      );
    }
  }

  /**
   * @param restaurantId MUST already have been verified by RestaurantContextGuard.
   *                     This method enforces isolation; it does not decide access.
   */
  async runInTenant<T>(restaurantId: string, work: (tx: TenantTx) => Promise<T>): Promise<T> {
    if (!UUID_RE.test(restaurantId)) {
      // Defence in depth. The guard should have rejected this long before here.
      throw new InternalServerErrorException('invalid tenant context');
    }
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_restaurant_id', ${restaurantId}, true)`);
      return work(tx as TenantTx);
    });
  }

  /** Untenanted access, for the login path only (staff_accounts carries no RLS). */
  async runUnscoped<T>(work: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => work(tx as TenantTx));
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
