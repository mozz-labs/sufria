import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@sufria/shared";

/** drizzle جوا transaction محمّلة أصلا بسياق المستأجر. */
export type TenantTx = NodePgDatabase<typeof schema>;
