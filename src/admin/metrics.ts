export type MetricName =
  | 'users'
  | 'analyses'
  | 'slips'
  | 'bookingCodeRequests'
  | 'screenshotRequests'
  | 'aiRequests'
  | 'errors'
  | 'rateLimitEvents';

export class MetricsService {
  private readonly values = new Map<MetricName, number>();
  increment(name: MetricName, amount = 1): void {
    this.values.set(name, (this.values.get(name) ?? 0) + amount);
  }
  snapshot(): Record<MetricName, number> {
    return {
      users: this.values.get('users') ?? 0,
      analyses: this.values.get('analyses') ?? 0,
      slips: this.values.get('slips') ?? 0,
      bookingCodeRequests: this.values.get('bookingCodeRequests') ?? 0,
      screenshotRequests: this.values.get('screenshotRequests') ?? 0,
      aiRequests: this.values.get('aiRequests') ?? 0,
      errors: this.values.get('errors') ?? 0,
      rateLimitEvents: this.values.get('rateLimitEvents') ?? 0,
    };
  }
}
