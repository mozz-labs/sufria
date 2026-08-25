import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import { CurrentUser } from "./decorators/current-user.decorator.js";
import { Public } from "./decorators/public.decorator.js";
import { LoginDto, RefreshDto } from "./dto/auth.dto.js";
import type { AuthenticatedUser, LoginResult } from "./auth.types.js";

/**
 * 🔴 ما في POST /auth/register — وهذا مقصود.
 * الحسابات بتنعمل من المنصة (SRS §1.2). نقطة تسجيل مفتوحة معناها إن أي حدا
 * على الإنترنت بيعمل حساب موظف.
 */
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<LoginResult> {
    return this.auth.login(dto.phoneOrEmail, dto.password);
  }

  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto): Promise<{ accessToken: string }> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  logout(@CurrentUser() user: AuthenticatedUser): Promise<{ ok: true }> {
    return this.auth.logout(user.staffAccountId);
  }
}
