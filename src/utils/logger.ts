import pino from 'pino';
import type { AppConfig } from '../config/env.js';

export function createLogger(config: Pick<AppConfig, 'LOG_LEVEL' | 'NODE_ENV'>) {
  return pino({
    name: 'SlipPilot AI',
    level: config.LOG_LEVEL,
    base: { service: 'slippilot-ai', environment: config.NODE_ENV },
    redact: {
      paths: ['req.headers.authorization', 'telegramToken', '*.password', '*.secret', '*.apiKey'],
      censor: '[REDACTED]',
    },
  });
}
