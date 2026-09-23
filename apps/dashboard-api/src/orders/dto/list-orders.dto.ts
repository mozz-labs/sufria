import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { ORDER_TABS } from "@sufria/shared";

/**
 * `GET /orders?tab=active|history&page=N` — brief D §3.1.
 *
 * `page` is query text, so it is checked by a pattern, not by conversion:
 * `z.coerce` accepts `""`, `" 1"` and `1.0`. It is validated whenever it is
 * sent, even with `active`, which ignores it. Capped at nine digits so the
 * offset stays an exact integer in JavaScript.
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
