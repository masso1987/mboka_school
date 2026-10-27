import { existsSync } from 'node:fs';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  SESSION_TTL_HOURS: z.coerce.number().positive().max(24 * 30).default(12),
  /** Login attempts per client per minute. */
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  /** Requests per client per minute on every route (load tests raise it). */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  /** Queries slower than this are logged as warnings (SQL text only, never parameter values); 0 = off. */
  SLOW_QUERY_MS: z.coerce.number().int().nonnegative().default(500),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Validated environment. Fails fast at boot rather than at first use. */
export function env(): Env {
  if (!cached) {
    if (existsSync('.env') && typeof process.loadEnvFile === 'function') process.loadEnvFile('.env');
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment: ${z.prettifyError(parsed.error)}`);
    }
    cached = parsed.data;
  }
  return cached;
}
