import { InjectionToken } from '@angular/core';

export interface StripeConfig {
  publishableKey: string;
  mockPayments: boolean;
}

export const STRIPE_CONFIG = new InjectionToken<StripeConfig>('STRIPE_CONFIG');
