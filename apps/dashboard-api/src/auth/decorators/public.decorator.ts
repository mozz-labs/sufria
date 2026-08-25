import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC = "isPublic";

/**
 * كل نقطة محمية افتراضيا (JwtAuthGuard مسجّل عالميا).
 * الاستثناء لازم ينكتب صراحة — فنسيان الحماية مستحيل، ونسيان الفتح واضح.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);
