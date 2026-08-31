import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { eq, sql } from "drizzle-orm";
import { staffAccounts } from "@sufria/shared";
import { TenantDbService } from "../db/tenant-db.service.js";
import { env, ttlSeconds } from "../config/env.js";
import type {
  JwtPayload,
  LoginResult,
  RestaurantMembership,
} from "./auth.types.js";

/**
 * 🔴 نص واحد لكل أسباب فشل الدخول.
 *
 * "المستخدم غير موجود" و "كلمة السر غلط" لازم يكونا غير قابلين للتمييز —
 * وإلا صار الفرق بينهما أداة لتعداد الحسابات: جرّب إيميلات، وشوف مين بيرد
 * برسالة مختلفة.
 */
const LOGIN_FAILED = "بيانات الدخول غير صحيحة";

@Injectable()
export class AuthService {
  constructor(
    private readonly db: TenantDbService,
    private readonly jwt: JwtService,
  ) {}

  async login(phoneOrEmail: string, password: string): Promise<LoginResult> {
    // runUnscoped لأن staff_accounts بينقرأ قبل ما يوجد سياق مطعم.
    // هذا الجدول محمي بطبقة التطبيق فقط — انظر تعليق 0001.
    const account = await this.db.runUnscoped(async (tx) => {
      const rows = await tx
        .select()
        .from(staffAccounts)
        .where(eq(staffAccounts.phoneOrEmail, phoneOrEmail))
        .limit(1);
      return rows[0] ?? null;
    });

    // 🔴 هاش وهمي لما الحساب مش موجود: بلاه، الرد بيرجع أسرع بكثير للإيميلات
    // غير الموجودة، وهذا فرق توقيت بيسمح بتعداد الحسابات بلا ما نرجّع رسالة
    // مختلفة أصلا.
    const hash = account?.passwordHash ?? DUMMY_HASH;
    const ok = await verify(hash, password);

    if (!account || !account.isActive || !ok) {
      throw new UnauthorizedException(LOGIN_FAILED);
    }

    const memberships = await this.membershipsOf(account.id);
    // موظف بلا ولا عضوية فعّالة ما إله لوحة يدخلها — ونفس الرسالة، بلا تلميح.
    if (memberships.length === 0) throw new UnauthorizedException(LOGIN_FAILED);

    const tokens = await this.issue(account.id);
    await this.storeRefreshToken(account.id, tokens.refreshToken);

    return {
      ...tokens,
      staff: { id: account.id, name: account.name, role: memberships[0]!.role },
      restaurants: memberships,
    };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string }> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken);
    } catch {
      throw new UnauthorizedException();
    }
    if (payload.typ !== "refresh") throw new UnauthorizedException();

    const account = await this.db.runUnscoped(async (tx) => {
      const rows = await tx
        .select()
        .from(staffAccounts)
        .where(eq(staffAccounts.id, payload.sub))
        .limit(1);
      return rows[0] ?? null;
    });

    // التوقيع صحيح مش كافي: لازم تكون نفس التذكرة المخزّنة، وغير منتهية،
    // والحساب لسه فعّال. هيك تسجيل الخروج بيلغي فعليا بدل ما يكون شكليا.
    if (
      !account?.isActive ||
      !account.refreshTokenHash ||
      !account.refreshTokenExpiresAt ||
      account.refreshTokenExpiresAt.getTime() < Date.now() ||
      !(await verify(account.refreshTokenHash, refreshToken))
    ) {
      throw new UnauthorizedException();
    }

    const accessToken = await this.jwt.signAsync(
      { sub: account.id, typ: "access" } satisfies JwtPayload,
      { expiresIn: ttlSeconds(env().JWT_ACCESS_TTL) },
    );
    return { accessToken };
  }

  async logout(staffAccountId: string): Promise<{ ok: true }> {
    await this.db.runUnscoped((tx) =>
      tx
        .update(staffAccounts)
        .set({ refreshTokenHash: null, refreshTokenExpiresAt: null })
        .where(eq(staffAccounts.id, staffAccountId)),
    );
    return { ok: true };
  }

  // ------------------------------------------------------------- داخلي
  /**
   * 🔴 ممنوع الاستعلام المباشر عن restaurant_staff هون.
   *
   * سياسة RLS على ذاك الجدول مبنية على app.current_restaurant()، وعند تسجيل
   * الدخول ما في سياق مطعم بعد — فالدور المقيّد بيقرأ صفر صفوف وكل تسجيل
   * دخول بيفشل. الحل مش تخفيف السياسة، بل دالة SECURITY DEFINER ضيّقة
   * (Bypass #3، migration 0005) بترجّع أربعة أعمدة لحساب واحد وبس.
   */
  private async membershipsOf(
    staffAccountId: string,
  ): Promise<RestaurantMembership[]> {
    const res = await this.db.runUnscoped((tx) =>
      tx.execute<{
        id: string;
        name: string;
        location: string | null;
        role: string;
      }>(sql`SELECT * FROM app.restaurants_for_staff(${staffAccountId}::uuid)`),
    );
    return res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      branch: r.location,
      role: r.role,
    }));
  }

  private async issue(
    sub: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync({ sub, typ: "access" } satisfies JwtPayload, {
        expiresIn: ttlSeconds(env().JWT_ACCESS_TTL),
      }),
      this.jwt.signAsync({ sub, typ: "refresh" } satisfies JwtPayload, {
        expiresIn: ttlSeconds(env().JWT_REFRESH_TTL),
      }),
    ]);
    return { accessToken, refreshToken };
  }

  private async storeRefreshToken(id: string, token: string): Promise<void> {
    // نخزّن الهاش مش التذكرة: قاعدة مسروقة ما بتعطي جلسات صالحة.
    const hash = await argon2.hash(token, { type: argon2.argon2id });
    const expiresAt = new Date(
      Date.now() + ttlSeconds(env().JWT_REFRESH_TTL) * 1000,
    );
    await this.db.runUnscoped((tx) =>
      tx
        .update(staffAccounts)
        .set({ refreshTokenHash: hash, refreshTokenExpiresAt: expiresAt })
        .where(eq(staffAccounts.id, id)),
    );
  }
}

async function verify(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // هاش تالف أو بصيغة قديمة — فشل، مش انهيار.
    return false;
  }
}

/** هاش argon2id صالح لكلمة سر عشوائية. يُستهلك وقتا مكافئا للتحقق الحقيقي. */
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,p=4,t=3$YmFkc2FsdGJhZHNhbHQ$YmFkaGFzaGJhZGhhc2hiYWRoYXNoYmFkaGFzaGJhZGg";
