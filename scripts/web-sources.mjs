/**
 * The files of apps/dashboard-web that the two design gates read:
 * everything written by hand, nothing generated or installed.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const WEB_ROOT = "apps/dashboard-web";

const SKIP_DIRS = new Set(["node_modules", ".next", "public"]);
const SKIP_FILES = new Set(["next-env.d.ts"]);

/** Relative paths under WEB_ROOT whose extension matches `pattern`. */
export function webSources(pattern) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (!SKIP_DIRS.has(entry)) walk(full);
      } else if (pattern.test(entry) && !SKIP_FILES.has(entry)) {
        out.push(relative(".", full));
      }
    }
  };
  walk(WEB_ROOT);
  return out.sort();
}
