import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';
import { ApiSportsClient, ApiSportsError, type ApiSportsProduct } from '../api-sports/client.js';
import type { VerifiedFixtureIdentityRegistry } from '../api-sports/fixture-identity.js';
import type {
  ApiSportsOperationalSnapshot,
  ApiSportsOperations,
} from '../api-sports/operations.js';
import type { SportyBetProvider } from '../sportybet/contracts.js';
import { ApiSportsFixtureMatcher } from '../api-sports/fixture-matcher.js';
import { buildApiSportsCoverageReport } from '../api-sports/coverage.js';

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
  dataRightsConfirmed: boolean;
  sportFlagEnabled: boolean;
  activationBlock?:
    | 'client_disabled'
    | 'missing_key'
    | 'sport_disabled'
    | 'commercial_use_not_declared'
    | 'data_rights_unconfirmed';
  message: string;
  requestsToday?: number;
  dailyLimit?: number;
  operational?: ApiSportsOperationalSnapshot;
  verifiedMappings?: { competitions: number; teams: number };
}

const diagnosticMessage: Record<DiagnosticState, string> = {
  disabled: 'API-Sports client is switched off in this deployment.',
  missing_key: 'API_SPORTS_KEY is missing in this deployment.',
  connected:
    'API-Sports status authenticated; fixture coverage and statistics have not been tested.',
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
    config.API_SPORTS_DATA_RIGHTS_CONFIRMED &&
    flag,
  );
  const activationBlock: ProviderDiagnostic['activationBlock'] = !config.API_SPORTS_ENABLED
    ? 'client_disabled'
    : !config.API_SPORTS_KEY
      ? 'missing_key'
      : !flag
        ? 'sport_disabled'
        : !config.API_SPORTS_COMMERCIAL_USE_APPROVED
          ? 'commercial_use_not_declared'
          : !config.API_SPORTS_DATA_RIGHTS_CONFIRMED
            ? 'data_rights_unconfirmed'
            : undefined;
  const base = {
    product,
    analysisEnabled,
    approvalDeclared: config.API_SPORTS_COMMERCIAL_USE_APPROVED,
    dataRightsConfirmed: config.API_SPORTS_DATA_RIGHTS_CONFIRMED,
    sportFlagEnabled: flag,
    ...(activationBlock ? { activationBlock } : {}),
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
export interface ProviderDiagnosticDependencies {
  client?: ApiSportsClient;
  identities?: VerifiedFixtureIdentityRegistry;
  operations?: ApiSportsOperations;
  sportyBet?: SportyBetProvider;
}

export function registerApiSportsDiagnosticRoutes(
  app: FastifyInstance,
  config: AppConfig,
  dependencies: ProviderDiagnosticDependencies = {},
): void {
  const client =
    dependencies.client ??
    (config.API_SPORTS_ENABLED && config.API_SPORTS_KEY
      ? new ApiSportsClient({
          apiKey: config.API_SPORTS_KEY,
          timeoutMs: config.API_SPORTS_TIMEOUT_MS,
          maxRetries: config.API_SPORTS_MAX_RETRIES,
        })
      : undefined);
  app.get(
    '/api/miniapp/provider-status',
    { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
    async (_request, reply) => {
      reply.header('cache-control', 'no-store');
      const [football, basketball] = await Promise.all([
        diagnoseApiSports(config, 'football', client),
        diagnoseApiSports(config, 'basketball', client),
      ]);
      for (const diagnostic of [football, basketball]) {
        if (dependencies.operations)
          diagnostic.operational = dependencies.operations.snapshot(diagnostic.product);
        if (dependencies.identities)
          diagnostic.verifiedMappings = dependencies.identities.counts(diagnostic.product);
      }
      return {
        service: 'API-Sports',
        deployment: process.env.VERCEL_ENV ?? 'local',
        football,
        basketball,
        note: 'Status authentication, feature activation, fixture retrieval, statistics retrieval and approved selections are separate states. Process-local operational history may reset between serverless instances. Subscription access does not prove publication or betting-analysis rights.',
      };
    },
  );
  app.post(
    '/api/miniapp/provider-coverage',
    { config: { rateLimit: { max: 1, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const input = z
        .object({
          sport: z.enum(['football', 'basketball']),
          maximumFixtures: z.number().int().min(1).max(20).default(10),
        })
        .strict()
        .parse(request.body);
      if (!config.API_SPORTS_ENABLED)
        return reply.status(409).send({
          status: 'feature_disabled',
          message: 'API-Sports fixture diagnostics are disabled in this deployment.',
        });
      if (!client)
        return reply.status(424).send({
          status: 'missing_key',
          message: 'API-Sports fixture diagnostics cannot run because no server key is configured.',
        });
      if (!dependencies.sportyBet)
        return reply.status(424).send({
          status: 'provider_unavailable',
          message: 'SportyBet fixture discovery is unavailable for this diagnostic.',
        });
      const events = (await dependencies.sportyBet.listEvents(input.sport))
        .filter((event) => event.status === 'scheduled' && event.startsAt.getTime() > Date.now())
        .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())
        .slice(0, input.maximumFixtures);
      const report = await buildApiSportsCoverageReport(
        input.sport,
        events,
        new ApiSportsFixtureMatcher(client, dependencies.identities, dependencies.operations),
        new Date(),
        { concurrency: 2, deadlineAt: Date.now() + 20_000 },
      );
      return {
        status: 'coverage_test_completed',
        report,
        disclaimer:
          'This diagnostic tests fixture identity only. It does not prove historical statistics coverage, data rights, analysis approval or a betting outcome.',
      };
    },
  );
}
