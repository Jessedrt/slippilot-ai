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
  SPORTYBET_REGION: z.string().regex(/^[a-z]{2}$/i).default('ng'),
  SPORTYBET_API_BASE_URL: z.string().url().default('https://www.sportybet.com'),
  SPORTYBET_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  SPORTYBET_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(250),
  SPORTYBET_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(4),
  SPORTYBET_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(3),
  SPORTYBET_CACHE_TTL_MS: z.coerce.number().int().positive().default(90_000),
  SPORTYBET_TIMELINE_HOURS: z.coerce.number().int().min(12).max(720).default(720),
  SPORTYBET_PAGE_SIZE: z.coerce.number().int().min(1).max(100).default(100),
  SPORTYBET_MAX_PAGES: z.coerce.number().int().min(1).max(20).default(5),
  SPORTYBET_FOOTBALL_MARKET_IDS: z.string().default(
    '1,10,11,14,16,18,21,23,24,25,26,29,30,31,32,35,36,37,45,47,50,51,52,55,56,57,60,63,64,65,68,71,74,75,83,85,86,87,90,93,95,162,163,164,165,166,172,184,60100,60110,60200,60210',
  ),
  SPORTYBET_BASKETBALL_MARKET_IDS: z.string().default('219,223,225,227,228'),
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
