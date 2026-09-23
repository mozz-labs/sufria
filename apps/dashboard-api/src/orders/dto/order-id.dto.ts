import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * `:id` بـ`/orders/:id`. معرّف مش UUID ← 400 قبل ما يوصل القاعدة (بريف د §3.2).
 *
 * `z.guid()` لا `z.uuid()`: الأخيرة بتفحص خانتي الإصدار والـvariant، فبترفض
 * معرّفا بتقبله Postgres. نفس الشكل اللي بيفحصه RestaurantContextGuard.
 *
 * 🔴 اسم الباراميتر `id`، وممنوع يصير `restaurantId`: الحارس بيقرأ
 *    `req.params.restaurantId` قبل الهيدر (بريف د §8.1).
 */
const OrderIdParamSchema = z.object({
  id: z.guid(),
});

export class OrderIdParamDto extends createZodDto(OrderIdParamSchema) {}
