import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config/env.js';
import {
  ApiSportsClient,
  ApiSportsError,
  type ApiSportsProduct,
} from '../api-sports/client.js';

export type DiagnosticState =
  | 'disabled'
  | 'missing_key'
  | 'connected'
  | 'inactive_subscription'
  | 'unauthorized'
  | 'missing_entitlement'
  | 'quota_exhausted'
  | 'rate_limited'
  | 'invalid_response'
  | 'timeout'
  | 'provider_unavailable';

export interface ProviderDiagnostic {
  product: ApiSportsProduct;
  state: DiagnosticState;
  analysisEnabled: boolean;
  approvalDeclared: boolean;
  message: string;
  requestsToday?: number;
  dailyLimit?: number;
}

const diagnosticMessage: Record<DiagnosticState, string> = {
  disabled: 'API-Sports client is switched off in this deployment.',
  missing_key: 'API_SPORTS_KEY is missing in this deployment.',
  connected: 'API-Sports status authenticated; fixture coverage and statistics have not been tested.',
  inactive_subscription: 'API-Sports reports that this product subscription is inactive.',
  unauthorized: 'API-Sports rejected this server credential.',
  missing_entitlement: 'The configured account cannot access this API-Sports product.',
  quota_exhausted: 'The API-Sports daily request quota is exhausted.',
  rate_limited: 'API-Sports rate-limited the status request.',
  invalid_response: 'The provider status response did not pass validation.',
  timeout: 'The API-Sports status request timed out.',
  provider_unavailable: 'Could not reach the API-Sports status endpoint.',
};

export async function diagnoseApiSports(
  config: AppConfig,
  product: ApiSportsProduct,
  client?: Pick<ApiSportsClient, 'verifyEntitlement'>,
): Promise<ProviderDiagnostic> {
  const flag =
    product === 'football'
      ? config.API_SPORTS_FOOTBALL_ENABLED
      : config.API_SPORTS_BASKETBALL_TOTALS_ENABLED;
  const analysisEnabled = Boolean(
    config.API_SPORTS_ENABLED &&
      config.API_SPORTS_KEY &&
      config.API_SPORTS_COMMERCIAL_USE_APPROVED &&
      flag,
  );
  const base = {
    product,
    analysisEnabled,
    approvalDeclared: config.API_SPORTS_COMMERCIAL_USE_APPROVED,
  };
  if (!config.API_SPORTS_ENABLED)
    return { ...base, state: 'disabled', message: diagnosticMessage.disabled };
  if (!config.API_SPORTS_KEY || !client)
    return { ...base, state: 'missing_key', message: diagnosticMessage.missing_key };

  try {
    // /status is a credentialed, no-cache check; it normally does not consume fixture quota.
    // Never expose account details (name/email) contained in its raw response.
    const result = await client.verifyEntitlement(product);
    const active = result.data.subscription.active;
    const currentState = active === true || active === 1 ? 'connected' : 'inactive_subscription';
    return {
      ...base,
      state: currentState,
      message: diagnosticMessage[currentState],
      requestsToday: result.data.requests.current,
      dailyLimit: result.data.requests.limit_day,
    };
  } catch (error) {
    const state: DiagnosticState =
      error instanceof ApiSportsError
        ? error.code === 'provider_error' || error.code === 'not_configured'
          ? 'provider_unavailable'
          : error.code
        : 'provider_unavailable';
    return { ...base, state, message: diagnosticMessage[state] };
  }
}

/** Registered after the existing Mini App Telegram preHandler. Never register as a public route. */
export function registerApiSportsDiagnosticRoutes(app: FastifyInstance, config: AppConfig): void {
  const client =
    config.API_SPORTS_ENABLED && config.API_SPORTS_KEY
      ? new ApiSportsClient({
          apiKey: config.API_SPORTS_KEY,
          timeoutMs: config.API_SPORTS_TIMEOUT_MS,
          maxRetries: config.API_SPORTS_MAX_RETRIES,
        })
      : undefined;
  app.get(
    '/api/miniapp/provider-status',
    { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
    async (_request, reply) => {
      reply.header('cache-control', 'no-store');
      const [football, basketball] = await Promise.all([
        diagnoseApiSports(config, 'football', client),
        diagnoseApiSports(config, 'basketball', client),
      ]);
      return {
        service: 'API-Sports',
        deployment: process.env.VERCEL_ENV ?? 'local',
        football,
        basketball,
        note: 'Status calls do not prove fixture mapping, statistics coverage, publication rights or successful predictions. The /status endpoint may not increase dashboard usage.',
      };
    },
  );
}
