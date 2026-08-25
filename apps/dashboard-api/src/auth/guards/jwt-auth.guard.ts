import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { IS_PUBLIC } from "../decorators/public.decorator.js";
import type { AuthenticatedUser, JwtPayload } from "../auth.types.js";

/**
 * مسجّل عالميا بـapp.module.ts. كل نقطة محمية إلا اللي عليها @Public().
 *
 * بيقبل تذاكر `access` فقط: تذكرة التجديد صالحة ٣٠ يوم، فلو انقبلت كتذكرة
 * وصول بتلغي كل فايدة الـ١٥ دقيقة القصيرة.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: AuthenticatedUser;
    }>();

    const raw = req.headers["authorization"];
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedException();

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(header.slice(7));
    } catch {
      throw new UnauthorizedException();
    }

    if (payload.typ !== "access") throw new UnauthorizedException();

    req.user = { staffAccountId: payload.sub };
    return true;
  }
}
