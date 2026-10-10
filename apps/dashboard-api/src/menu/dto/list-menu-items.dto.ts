import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * `GET /menu-items[?archived=true]` — brief ي-أ §5. `archived` is query text:
 * `"true"` lists the archived items alone; `"false"`, or no `archived` at all,
 * lists the menu. Any other value is a 400.
 */
const ListMenuItemsQuerySchema = z.object({
  archived: z.enum(["true", "false"]).optional(),
});

export class ListMenuItemsQueryDto extends createZodDto(
  ListMenuItemsQuerySchema,
) {}
