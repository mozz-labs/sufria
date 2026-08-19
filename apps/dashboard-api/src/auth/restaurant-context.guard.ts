import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  BadRequestException,
} from "@nestjs/common";
import { sql } from "drizzle-orm";
import { TenantDbService } from "../db/tenant-db.service.js";

/**
 * NFR-02 / Blueprint §5.5:
 *   "Guard يتحقق من restaurant_staff قبل تفعيل RLS session variable"
 *
 * Order of operations matters and is the whole point of this class:
 *
 *   1. AuthGuard (runs before this one) verifies the JWT   -> who is the caller
 *   2. THIS guard verifies restaurant_staff membership     -> may they act here
 *   3. Only then does TenantDbService set the RLS context  -> what they can see
 *
 * Doing 3 before 2 would mean the caller chooses their own tenant id and RLS
 * faithfully hands them that tenant's data. RLS constrains a request to one
 * restaurant; it has no opinion about *which*. That decision is made here, and
 * nowhere else.
 *
 * The guard deliberately does not open the request transaction. It attaches a
 * verified id to the request; TenantDbService opens the transaction and sets
 * the context from that id. Keeping the two apart means a service cannot end up
 * holding a context that was never checked.
 */
@Injectable()
export class RestaurantContextGuard implements CanActivate {
  constructor(private readonly tenantDb: TenantDbService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();

    const staffAccountId: string | undefined = req.user?.staffAccountId;
    if (!staffAccountId) {
      throw new ForbiddenException();
    }

    const restaurantId =
      req.params?.restaurantId ?? req.headers["x-restaurant-id"];
    if (typeof restaurantId !== "string" || !UUID_RE.test(restaurantId)) {
      throw new BadRequestException("missing or malformed restaurant context");
    }

    // The single privileged call in the whole service. SECURITY DEFINER, returns
    // a boolean and nothing else — no rows, no ids, no names. See migration 0003.
    const res = await this.tenantDb.runUnscoped((tx) =>
      tx.execute<{ ok: boolean }>(
        sql`SELECT app.verify_membership(${staffAccountId}::uuid, ${restaurantId}::uuid) AS ok`,
      ),
    );

    // .rows، مش المصفوفة مباشرة. لو انكتبت غلط، الشرط بيصير دايما "مرفوض"
    // وكل الداشبورد بيرجع 403 — أو أسوأ، لو انعكس المنطق، دايما "مقبول".
    if (res.rows[0]?.ok !== true) {
      // Indistinguishable from "no such restaurant" on purpose: a caller must not
      // be able to enumerate restaurants by comparing 403 against 404.
      throw new ForbiddenException();
    }

    req.restaurantId = restaurantId;
    return true;
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
