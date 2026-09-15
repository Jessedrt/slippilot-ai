import { z } from 'zod';

const blankToUndefined = (value: unknown) => (value === '' ? undefined : value);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  TELEGRAM_BOT_TOKEN: z.preprocess(blankToUndefined, z.string().min(10).optional()),
  DATABASE_URL: z
    .string()
    .url()
    .default('postgresql://slippilot:slippilot@localhost:5432/slippilot'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  AI_PROVIDER: z.string().default('disabled'),
  AI_API_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  AI_MODEL: z.preprocess(blankToUndefined, z.string().optional()),
  SPORTS_PROVIDER: z.string().default('disabled'),
  SPORTS_API_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  SPORTYBET_PROVIDER_ENABLED: z.stringbool().default(false),
  SPORTYBET_REGION: z.string().regex(/^[a-z]{2}$/).default('ng'),
  SPORTYBET_API_BASE_URL: z.string().url().default('https://www.sportybet.com'),
  SPORTYBET_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  SPORTYBET_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(350),
  SPORTYBET_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  SPORTYBET_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  SPORTYBET_CACHE_TTL_MS: z.coerce.number().int().positive().default(30_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ADMIN_SECRET: z.preprocess(blankToUndefined, z.string().min(16).optional()),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid SlipPilot AI configuration: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
