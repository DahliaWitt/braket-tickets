export interface BuildEnvironment {
  commitHash: string;
  branch: string;
  timestamp: string;
}

export interface StripeEnvironment {
  publishableKey: string;
  mockPayments: boolean;
}

export interface PostHogEnvironment {
  apiKey: string;
  host: string;
}

export interface AppEnvironment {
  production: boolean;
  convexUrl: string;
  convexSiteUrl: string;
  isE2E: boolean;
  build: BuildEnvironment;
  stripe: StripeEnvironment;
  sentryDsn: string;
  sentryEnvironment: string;
  enableSentry: boolean;
  enableSentryReplay: boolean;
  sentryReplaySessionSampleRate: number;
  sentryReplayOnErrorSampleRate: number;
  posthog: PostHogEnvironment;
}
