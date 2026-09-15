export const plans = {
  free: {
    name: 'Free',
    dailyAnalyses: 5,
    maximumSlipSize: 8,
    dailyScreenshots: 1,
    advancedOptimization: false,
  },
  pro: {
    name: 'Pro',
    dailyAnalyses: 100,
    maximumSlipSize: 30,
    dailyScreenshots: 20,
    advancedOptimization: true,
  },
} as const;

export type PlanId = keyof typeof plans;

export interface PaymentProvider {
  createCheckout(userId: string, plan: PlanId): Promise<{ url: string }>;
  verifyWebhook(payload: unknown, signature: string): Promise<boolean>;
}
