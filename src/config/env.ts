import { z } from 'zod';

const blankToUndefined = (value: unknown) => (value === '' ? undefined : value);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default('0.0.0.0'),
    TELEGRAM_BOT_TOKEN: z.preprocess(blankToUndefined, z.string().min(10).optional()),
    TELEGRAM_WEBHOOK_SECRET: z.preprocess(
      blankToUndefined,
      z
        .string()
        .min(16)
        .max(256)
        .regex(/^[A-Za-z0-9_-]+$/)
        .optional(),
    ),
    DATABASE_URL: z
      .string()
      .url()
      .default('postgresql://slippilot:slippilot@localhost:5432/slippilot'),
    REDIS_URL: z.string().url().default('redis://localhost:6379'),
    AI_PROVIDER: z.string().default('disabled'),
    AI_API_KEY: z.preprocess(blankToUndefined, z.string().optional()),
    GEMINI_API_KEY: z.preprocess(blankToUndefined, z.string().optional()),
    AI_MODEL: z.preprocess(blankToUndefined, z.string().optional()),
    SPORTS_PROVIDER: z.string().default('disabled'),
    SPORTS_API_KEY: z.preprocess(blankToUndefined, z.string().optional()),
    YOU_API_ENABLED: z.stringbool().default(false),
    YDC_API_KEY: z.preprocess(blankToUndefined, z.string().min(8).optional()),
    YOU_SEARCH_ENABLED: z.stringbool().default(true),
    YOU_RESEARCH_ENABLED: z.stringbool().default(true),
    YOU_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
    YOU_MAX_RESULTS: z.coerce.number().int().min(1).max(100).default(8),
    YOU_CACHE_TTL_MS: z.coerce.number().int().min(1_000).default(300_000),
    SPORTYBET_PROVIDER_ENABLED: z.stringbool().default(false),
    SPORTYBET_REGION: z
      .string()
      .regex(/^[a-z]{2}$/)
      .default('ng'),
    SPORTYBET_API_BASE_URL: z.string().url().default('https://www.sportybet.com'),
    SPORTYBET_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    SPORTYBET_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(350),
    SPORTYBET_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
    SPORTYBET_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    SPORTYBET_CACHE_TTL_MS: z.coerce.number().int().positive().default(30_000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    ADMIN_SECRET: z.preprocess(blankToUndefined, z.string().min(16).optional()),
  })
  .superRefine((config, context) => {
    if (config.YOU_API_ENABLED && !config.YDC_API_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['YDC_API_KEY'],
        message: 'YDC_API_KEY is required when YOU_API_ENABLED=true',
      });
    }
    if (config.AI_PROVIDER === 'gemini' && !config.GEMINI_API_KEY && !config.AI_API_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['GEMINI_API_KEY'],
        message: 'GEMINI_API_KEY or AI_API_KEY is required when AI_PROVIDER=gemini',
      });
    }
    if (config.NODE_ENV === 'production') {
      for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET'] as const) {
        if (!config[key]) {
          context.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required in production`,
          });
        }
      }
      if (config.DATABASE_URL.includes('localhost')) {
        context.addIssue({
          code: 'custom',
          path: ['DATABASE_URL'],
          message: 'DATABASE_URL must not use localhost in production',
        });
      }
      if (config.REDIS_URL.includes('localhost')) {
        context.addIssue({
          code: 'custom',
          path: ['REDIS_URL'],
          message: 'REDIS_URL must not use localhost in production',
        });
      }
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid SlipPilot AI configuration: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
