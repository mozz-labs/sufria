/**
 * Brief I §2.2: the structure's three import rules, held the only way a
 * script can — by reading every import of `app/`, `features/` and `shared/`:
 *   1. `app/` composes: it imports from `features/` and `shared/` (and its
 *      own files, like `globals.css`), nothing else of the app.
 *   2. No feature imports another feature. What two features share belongs
 *      in `shared/`.
 *   3. `shared/` imports neither `features/` nor `app/`.
 * Packages (`react`, `next/…`, `@sufria/shared`) are not the app's own
 * code and are not checked here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const LAYERS = ["app", "features", "shared"] as const;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx|css)$/.test(entry) ? [full] : [];
  });
}

/** The code without its comments: `//…`, `/* … *\/` and JSX `{/* … *\/}`. */
function withoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/**
 * Every module a source names, with its line: `import … from "x"`,
 * `export … from "x"`, `import "x"`, `import("x")`, and in CSS `@import "x"`
 * and `composes: … from "x"`.
 */
function specifiers(src: string): { spec: string; line: number }[] {
  const code = withoutComments(src);
  const found: { spec: string; line: number }[] = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /@import\s+(?:url\(\s*)?["']([^"']+)["']/g,
  ];
  for (const re of patterns)
    for (const m of code.matchAll(re))
      found.push({
        spec: m[1]!,
        line: code.slice(0, m.index).split("\n").length,
      });
  return found;
}

type Place =
  | { layer: "app" | "shared" | "outside" }
  | { layer: "features"; feature: string };

/** Where a path under the app's root lies. */
function placeOf(pathFromRoot: string): Place {
  const [first, second] = pathFromRoot.split(/[\\/]/);
  if (first === "features" && second)
    return { layer: "features", feature: second };
  if (first === "app" || first === "shared") return { layer: first };
  return { layer: "outside" };
}

/**
 * The rule an import breaks, or `null`. `from` is the importing file's path
 * under the app's root; a package specifier breaks nothing.
 */
function brokenRule(from: string, spec: string): string | null {
  let target: string;
  if (spec.startsWith("."))
    target = relative(APP_ROOT, resolve(APP_ROOT, dirname(from), spec));
  else if (spec.startsWith("@/")) target = spec.slice(2);
  else return null;

  const source = placeOf(from);
  const dest = placeOf(target);
  if (source.layer === "app") {
    return dest.layer === "outside"
      ? `app/ imports only from features/ and shared/ — not ${target}`
      : null;
  }
  if (source.layer === "shared") {
    return dest.layer === "shared"
      ? null
      : `shared/ imports neither features/ nor app/ — not ${target}`;
  }
  if (source.layer === "features") {
    if (dest.layer === "shared") return null;
    if (dest.layer === "features" && dest.feature === source.feature)
      return null;
    return dest.layer === "features"
      ? `features/${source.feature} imports features/${dest.feature} — what two features share belongs in shared/`
      : `features/ imports only its own feature and shared/ — not ${target}`;
  }
  return null;
}

test("app/ composes, no feature imports another, shared/ imports neither", () => {
  const sources = LAYERS.flatMap((layer) => files(join(APP_ROOT, layer)));
  assert.ok(sources.length >= 10, "the walk found nothing — it is broken");
  const broken: string[] = [];
  for (const file of sources) {
    const from = relative(APP_ROOT, file).split(sep).join("/");
    for (const { spec, line } of specifiers(readFileSync(file, "utf8"))) {
      const rule = brokenRule(from, spec);
      if (rule) broken.push(`${from}:${line} «${spec}»: ${rule}`);
    }
  }
  assert.deepEqual(broken, [], `\n${broken.join("\n")}\n`);
});

test("🔴 the guard's own proof: each rule is caught, the allowed imports are not", () => {
  // Rule 2, in both directions, and through a re-export.
  assert.match(
    brokenRule(
      "features/orders/components/order-card.tsx",
      "../../auth/hooks/use-session.ts",
    ) ?? "",
    /features\/orders imports features\/auth/,
  );
  assert.ok(
    brokenRule("features/auth/lib/session.ts", "../../orders/lib/board.ts"),
  );
  assert.deepEqual(
    specifiers(`export { x } from "../../auth/lib/session.ts";`).map(
      (s) => s.spec,
    ),
    ["../../auth/lib/session.ts"],
  );
  // Rule 3.
  assert.ok(
    brokenRule(
      "shared/layout/dashboard-header.tsx",
      "../../features/orders/lib/board.ts",
    ),
  );
  assert.ok(brokenRule("shared/ui/brand-mark.tsx", "../../app/page.tsx"));
  // Rule 1, and the alias resolves like a relative path.
  assert.ok(brokenRule("app/page.tsx", "../lib/client.ts"));
  assert.ok(
    brokenRule(
      "features/orders/lib/board.ts",
      "@/features/auth/lib/session.ts",
    ),
  );
  // Allowed: app → features and shared, a feature → itself and shared,
  // shared → shared, any package.
  assert.equal(
    brokenRule("app/page.tsx", "../features/auth/components/login-form.tsx"),
    null,
  );
  assert.equal(brokenRule("app/layout.tsx", "./globals.css"), null);
  assert.equal(
    brokenRule("features/orders/components/order-card.tsx", "../lib/board.ts"),
    null,
  );
  assert.equal(
    brokenRule(
      "features/orders/api/orders-api.ts",
      "../../../shared/api/http.ts",
    ),
    null,
  );
  assert.equal(brokenRule("shared/api/client.ts", "./http.ts"), null);
  assert.equal(
    brokenRule("shared/layout/dashboard-header.tsx", "@sufria/shared"),
    null,
  );
  // A commented-out import is not an import.
  assert.deepEqual(
    specifiers(`// import x from "../../auth/x.ts";\nconst a = 1;`),
    [],
  );
});
