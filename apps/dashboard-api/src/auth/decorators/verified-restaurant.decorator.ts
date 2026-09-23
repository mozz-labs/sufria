import {
  createParamDecorator,
  type ExecutionContext,
  InternalServerErrorException,
} from "@nestjs/common";

/**
 * المطعم اللي تحقّق منه RestaurantContextGuard — ولا مصدر غيره (بريف د §8.1).
 *
 * 🔴 ممنوع قراءة المعرّف من الهيدر أو body أو query أو params بأي كود خارج
 *    الحارس. هيدر بلا تحقّق عضوية = أي موظف بيقرأ أي مطعم، وRLS بتسلّمه
 *    بيانات ذاك المطعم بأمانة.
 *
 * مسار نسي `@UseGuards(RestaurantContextGuard)` بيوصل هون بلا `restaurantId`،
 * فبيرجع 500 بدل ما يكمل بقيمة فاضية.
 */
export const VerifiedRestaurantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<{ restaurantId?: unknown }>();
    if (typeof req.restaurantId !== "string") {
      throw new InternalServerErrorException("restaurant context not verified");
    }
    return req.restaurantId;
  },
);
