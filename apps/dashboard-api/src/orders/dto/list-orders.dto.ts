import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { ORDER_TABS } from "@sufria/shared";

/**
 * `GET /orders?tab=active|history&page=N` — بريف د §3.1.
 *
 * `page` نص من الـquery، فبينفحص بنمط لا بتحويل: `z.coerce` بتقبل `""` و`" 1"`
 * و`1.0`. ويُتحقَّق منه كلما أُرسل، حتى مع `active` اللي بتلغي أثره.
 * سقف تسع خانات عشان الإزاحة تبقى عدد صحيح دقيق بجافاسكربت.
 */
const ListOrdersQuerySchema = z.object({
  tab: z.enum(ORDER_TABS),
  page: z
    .string()
    .regex(/^[1-9][0-9]{0,8}$/, "page must be a positive integer")
    .transform(Number)
    .optional(),
});

export class ListOrdersQueryDto extends createZodDto(ListOrdersQuerySchema) {}
