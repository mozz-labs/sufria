import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // apps/dashboard-web إله إعداد Next الخاص فيه — بينفحص عبر pnpm --filter
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      ".claude/**",
      "apps/dashboard-web/**",
      "docs/**",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
