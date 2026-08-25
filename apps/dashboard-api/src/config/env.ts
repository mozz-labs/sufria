import { z } from "zod";

/**
 * الإعدادات بتتفحص عند الإقلاع — مش عند أول استعمال.
 * متغيّر ناقص لازم يوقف السيرفر الآن، مش يفجّر طلب زبون بعد ساعتين.
 */
const EnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL مفقود — انسخ .env.example لـ.env"),
  JWT_SECRET: z
    .string()
    .min(16, "JWT_SECRET قصير — ولّد واحد: openssl rand -base64 48"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),
  DASHBOARD_API_PORT: z.coerce.number().int().positive().default(3002),
  PG_POOL_MAX: z.coerce.number().int().positive().default(10),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join(".")}: ${i.message}`,
    );
    throw new Error(`إعدادات البيئة غير صالحة:\n${lines.join("\n")}`);
  }
  cached = parsed.data;
  return cached;
}

/** ثواني من صيغة مثل "15m" أو "30d". */
export function ttlSeconds(v: string): number {
  const m = /^(\d+)([smhd])$/.exec(v.trim());
  if (!m) throw new Error(`صيغة مدة غير صالحة: ${v}`);
  const n = Number(m[1]);
  const unit = m[2] as "s" | "m" | "h" | "d";
  return n * { s: 1, m: 60, h: 3600, d: 86400 }[unit];
}
