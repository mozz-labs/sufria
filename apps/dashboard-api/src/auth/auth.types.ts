/**
 * 🔴 حمولة التذكرة ما بتحتوي restaurant_id — وهذا قرار معماري مقفول.
 *
 * الحساب ممكن يكون عضو بأكثر من فرع. لو المطعم انحط بالتذكرة، كل تبديل فرع
 * بيتطلب تسجيل دخول جديد. المطعم بينتحدد لكل طلب عبر هيدر X-Restaurant-Id،
 * وRestaurantContextGuard هو اللي بيتحقق من العضوية.
 *
 * وما في `role` بالحمولة كمان: الدور مرتبط بالمطعم (restaurant_staff.role)،
 * مش بالحساب. دور عام بحمولة التذكرة بيكسر نموذج السلاسل.
 */
export type JwtPayload = {
  sub: string; // staff_accounts.id
  typ: "access" | "refresh";
};

export type AuthenticatedUser = {
  staffAccountId: string;
};

// The login reply is part of the screen's contract: it lives in shared
// (brief G §3, G-2), and the API imports it from there.
export type { LoginResult, RestaurantMembership } from "@sufria/shared";
