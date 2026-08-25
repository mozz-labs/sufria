import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // لا تولّد AGENTS.md / CLAUDE.md داخل مجلد التطبيق
  agentRules: false,
};

export default nextConfig;
