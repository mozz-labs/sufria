import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/** Body of `PATCH /restaurant/orders-pause` — brief ي-أ §5. */
const OrdersPauseSchema = z.strictObject({
  paused: z.boolean(),
});

export class OrdersPauseDto extends createZodDto(OrdersPauseSchema) {}
