import type { NextConfig } from "next";

// The monorepo keeps one .env at the root (.env.example). Next reads only its
// own directory, so NEXT_PUBLIC_API_URL is taken from the root file here —
// the same file the API and the engine read with --env-file-if-exists.
try {
  process.loadEnvFile("../../.env");
} catch {
  // No root .env: lib/config.ts falls back to the development address.
}

const nextConfig: NextConfig = {
  // لا تولّد AGENTS.md / CLAUDE.md داخل مجلد التطبيق
  agentRules: false,
};

export default nextConfig;
