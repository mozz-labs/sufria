import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '@wafa/shared';

/** drizzle جوا transaction محمّلة أصلا بسياق المستأجر. */
export type TenantTx = NodePgDatabase<typeof schema>;
