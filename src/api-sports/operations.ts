import type { ApiSportsProduct, ApiSportsRequestEvent } from './client.js';

export interface OperationalCheck {
  tested: boolean;
  succeeded?: boolean;
  checkedAt?: string;
  source?: 'cache' | 'live' | 'mixed';
  reason?: string;
}

export interface ApiSportsOperationalSnapshot {
  fixtureRetrieval: OperationalCheck;
  statisticsRetrieval: OperationalCheck;
  latestAnalysis: OperationalCheck & { verifiedSelections?: number };
  requests: { live: number; cacheHits: number; failures: number };
}

const empty = (): ApiSportsOperationalSnapshot => ({
  fixtureRetrieval: { tested: false },
  statisticsRetrieval: { tested: false },
  latestAnalysis: { tested: false },
  requests: { live: 0, cacheHits: 0, failures: 0 },
});

/** Best-effort process-local diagnostics; never stores fixtures, users or credentials. */
export class ApiSportsOperations {
  private readonly products: Record<ApiSportsProduct, ApiSportsOperationalSnapshot> = {
    football: empty(),
    basketball: empty(),
  };

  recordRequest(event: ApiSportsRequestEvent): void {
    const metrics = this.products[event.product].requests;
    if (event.outcome === 'failure') metrics.failures += 1;
    else if (event.source === 'cache') metrics.cacheHits += 1;
    else metrics.live += 1;
  }

  recordFixture(
    product: ApiSportsProduct,
    succeeded: boolean,
    source?: OperationalCheck['source'],
    reason?: string,
  ): void {
    this.products[product].fixtureRetrieval = {
      tested: true,
      succeeded,
      checkedAt: new Date().toISOString(),
      ...(source ? { source } : {}),
      ...(reason ? { reason } : {}),
    };
  }

  recordStatistics(
    product: ApiSportsProduct,
    succeeded: boolean,
    source?: OperationalCheck['source'],
    reason?: string,
  ): void {
    this.products[product].statisticsRetrieval = {
      tested: true,
      succeeded,
      checkedAt: new Date().toISOString(),
      ...(source ? { source } : {}),
      ...(reason ? { reason } : {}),
    };
  }

  recordAnalysis(product: ApiSportsProduct, verifiedSelections: number): void {
    this.products[product].latestAnalysis = {
      tested: true,
      succeeded: verifiedSelections > 0,
      checkedAt: new Date().toISOString(),
      verifiedSelections,
    };
  }

  snapshot(product: ApiSportsProduct): ApiSportsOperationalSnapshot {
    return structuredClone(this.products[product]);
  }
}
