/**
 * The application-layer half of tenant isolation.
 *
 * tests/security/chain-isolation.sql already proves the RLS policies hold when
 * the context is set. It proves nothing about whether the *application* sets it,
 * because it sets the context by hand with SET ROLE + set_config. Every one of
 * its twelve assertions would still pass if RestaurantContextGuard were deleted.
 *
 * This suite covers the part no SQL test can reach: a real HTTP request going
 * through the real guards into the real TenantDbService, ending in a query whose
 * visible context is read back out of Postgres.
 *
 * Fixtures come from db/seed/chain-isolation-fixture.sql, so `pnpm db:seed` must
 * have run. The shape that matters: staff BOTH is an active member of branches A
 * and B of one chain; staff ONLY_A is a member of A alone.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import {
  Controller,
  Get,
  type INestApplication,
  Module,
  Req,
  UseGuards,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { sql } from "drizzle-orm";

import { AuthModule } from "../src/auth/auth.module.js";
import { JwtAuthGuard } from "../src/auth/guards/jwt-auth.guard.js";
import { RestaurantContextGuard } from "../src/auth/restaurant-context.guard.js";
import { DbModule } from "../src/db/db.module.js";
import { TenantDbService } from "../src/db/tenant-db.service.js";

const RESTAURANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RESTAURANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RESTAURANT_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const STAFF_BOTH = "50000000-0000-4000-8000-000000000001";
const STAFF_ONLY_A = "50000000-0000-4000-8000-000000000002";

const READ_CONTEXT = sql`SELECT current_setting('app.current_restaurant_id', true) AS ctx`;

type ContextRow = { ctx: string | null };

type ScopedBody = { context: string | null; verified: string };
type UnscopedBody = { context: string | null };

/** Response.json() is typed unknown; the probe routes below define the shape. */
const bodyOf = async <T>(res: Response): Promise<T> => (await res.json()) as T;

/**
 * Stands in for a real tenant-scoped endpoint. It is deliberately the thinnest
 * thing that still exercises the full path — guard verifies membership, service
 * opens the transaction and sets the context — and then reports what Postgres
 * actually sees, rather than what the application believes it set.
 */
@Controller("probe")
class ProbeController {
  constructor(private readonly tenantDb: TenantDbService) {}

  @UseGuards(RestaurantContextGuard)
  @Get("scoped")
  async scoped(
    @Req() req: { restaurantId: string },
  ): Promise<{ context: string | null; verified: string }> {
    const verified = req.restaurantId;
    return this.tenantDb.runInTenant(verified, async (tx) => {
      const res = await tx.execute<ContextRow>(READ_CONTEXT);
      return { context: res.rows[0]?.ctx ?? null, verified };
    });
  }

  /**
   * No RestaurantContextGuard and no runInTenant: reports whatever context the
   * pooled connection happens to be carrying. With PG_POOL_MAX=1 this is the
   * same connection the previous request used, which is what makes it a leak
   * detector rather than a coin flip.
   */
  @Get("unscoped")
  async unscoped(): Promise<{ context: string | null }> {
    return this.tenantDb.runUnscoped(async (tx) => {
      const res = await tx.execute<ContextRow>(READ_CONTEXT);
      return { context: res.rows[0]?.ctx ?? null };
    });
  }
}

@Module({
  imports: [DbModule, AuthModule],
  controllers: [ProbeController],
  // Mirrors app.module.ts: protected by default, opened only by @Public().
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
class ProbeModule {}

describe("tenant context (application layer)", () => {
  let app: INestApplication;
  let baseUrl: string;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProbeModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
    // getUrl() reports the IPv6 loopback on some hosts; fetch is happier with v4.
    baseUrl = (await app.getUrl()).replace("[::1]", "127.0.0.1");
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    // Closing the app runs onModuleDestroy, which ends the pg pool. Without it
    // Jest hangs on an open handle.
    await app?.close();
  });

  const accessToken = (staffAccountId: string): string =>
    jwt.sign({ sub: staffAccountId, typ: "access" });

  const probe = (
    path: string,
    opts: { token?: string; restaurantId?: string } = {},
  ): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (opts.token !== undefined)
      headers["authorization"] = `Bearer ${opts.token}`;
    if (opts.restaurantId !== undefined)
      headers["x-restaurant-id"] = opts.restaurantId;
    return fetch(`${baseUrl}${path}`, { headers });
  };

  describe("constructor injection resolved (ADR-004)", () => {
    // If TypeScript ever stops emitting design:paramtypes — the exact failure
    // ADR-004 documents — Nest injects undefined and this is the first thing to
    // go red, instead of a TypeError on some unrelated request months later.
    it("injects TenantDbService into the guard rather than undefined", () => {
      const guard = app.get(RestaurantContextGuard);
      expect(guard).toBeInstanceOf(RestaurantContextGuard);
      expect(app.get(TenantDbService)).toBeInstanceOf(TenantDbService);
    });
  });

  describe("a verified request", () => {
    it("sets the context to the restaurant the guard approved", async () => {
      const res = await probe("/probe/scoped", {
        token: accessToken(STAFF_BOTH),
        restaurantId: RESTAURANT_A,
      });

      expect(res.status).toBe(200);
      const body = await bodyOf<ScopedBody>(res);
      expect(body.verified).toBe(RESTAURANT_A);
      // The assertion that matters: Postgres, not the application, reports this.
      expect(body.context).toBe(RESTAURANT_A);
    });

    it("re-derives the context per request instead of reusing the last one", async () => {
      // Same staff account, same connection, different branch of the same chain.
      // A cached or connection-sticky context would still say A here.
      const first = await probe("/probe/scoped", {
        token: accessToken(STAFF_BOTH),
        restaurantId: RESTAURANT_A,
      });
      expect((await bodyOf<ScopedBody>(first)).context).toBe(RESTAURANT_A);

      const second = await probe("/probe/scoped", {
        token: accessToken(STAFF_BOTH),
        restaurantId: RESTAURANT_B,
      });
      expect(second.status).toBe(200);
      expect((await bodyOf<ScopedBody>(second)).context).toBe(RESTAURANT_B);
    });

    it("does not leave the context on the pooled connection", async () => {
      // This is what set_config(..., is_local => true) buys, and the one bug
      // that cannot be reproduced without a shared pool: the next request to
      // borrow the connection inherits the previous tenant.
      const scoped = await probe("/probe/scoped", {
        token: accessToken(STAFF_BOTH),
        restaurantId: RESTAURANT_A,
      });
      expect((await bodyOf<ScopedBody>(scoped)).context).toBe(RESTAURANT_A);

      const after = await probe("/probe/unscoped", {
        token: accessToken(STAFF_BOTH),
      });
      expect(after.status).toBe(200);
      // Postgres reverts a local setting to '' rather than dropping it.
      expect((await bodyOf<UnscopedBody>(after)).context ?? "").toBe("");
    });
  });

  describe("an unverified request never reaches a context", () => {
    it("refuses a restaurant the staff account is not a member of", async () => {
      const res = await probe("/probe/scoped", {
        token: accessToken(STAFF_ONLY_A),
        restaurantId: RESTAURANT_B,
      });
      expect(res.status).toBe(403);
    });

    it("refuses a restaurant that exists but shares no chain with the caller", async () => {
      const res = await probe("/probe/scoped", {
        token: accessToken(STAFF_ONLY_A),
        restaurantId: RESTAURANT_C,
      });
      expect(res.status).toBe(403);
    });

    it("rejects a malformed restaurant id before querying membership", async () => {
      const res = await probe("/probe/scoped", {
        token: accessToken(STAFF_BOTH),
        restaurantId: "not-a-uuid",
      });
      expect(res.status).toBe(400);
    });

    it("rejects a missing restaurant header", async () => {
      const res = await probe("/probe/scoped", {
        token: accessToken(STAFF_BOTH),
      });
      expect(res.status).toBe(400);
    });

    it("rejects an unauthenticated request before the context guard runs", async () => {
      const res = await probe("/probe/scoped", {
        restaurantId: RESTAURANT_A,
      });
      expect(res.status).toBe(401);
    });

    it("rejects a refresh token used as an access token", async () => {
      const refresh = jwt.sign({ sub: STAFF_BOTH, typ: "refresh" });
      const res = await probe("/probe/scoped", {
        token: refresh,
        restaurantId: RESTAURANT_A,
      });
      expect(res.status).toBe(401);
    });
  });
});
