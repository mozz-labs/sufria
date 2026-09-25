/**
 * Entry point of the restaurant setup script — brief E. Run it from the
 * repository root, the way `pnpm --filter @sufria/dashboard-api dev` runs
 * main.ts:
 *
 *   node --env-file-if-exists=.env \
 *     --import @swc-node/register/esm-register \
 *     apps/dashboard-api/src/scripts/setup-restaurant.ts db/restaurants/demo.json [--check]
 *
 * It lives inside dashboard-api, not in the root `scripts/`, because this is
 * where argon2 and the settings DTO's schemas resolve with no new dependency
 * (brief E, E-0 report), and inside `src/` so typecheck and lint cover it.
 * The logic is in `setup/setup-restaurant.ts`; this file only wires it to the
 * process.
 */
import { setupRestaurant } from "../setup/setup-restaurant.js";

void setupRestaurant(process.argv.slice(2), process.env, {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(
      `✗ setup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  },
);
