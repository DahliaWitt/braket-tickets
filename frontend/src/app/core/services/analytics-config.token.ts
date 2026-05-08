import { InjectionToken } from '@angular/core';
import { environment } from '../../../environments/environment';

export type AnalyticsRuntimeConfig = Pick<
  typeof environment,
  'production' | 'isE2E' | 'sentryEnvironment' | 'posthog' | 'build'
>;

export const ANALYTICS_RUNTIME_CONFIG = new InjectionToken<AnalyticsRuntimeConfig>(
  'ANALYTICS_RUNTIME_CONFIG',
  {
    providedIn: 'root',
    factory: () => ({
      production: environment.production,
      isE2E: environment.isE2E,
      sentryEnvironment: environment.sentryEnvironment,
      posthog: environment.posthog,
      build: environment.build,
    }),
  },
);
