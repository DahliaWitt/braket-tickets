import type {AppEnvironment} from './environment.model';

declare const __BRAKET_RUNTIME__: AppEnvironment;

const fallbackEnvironment: AppEnvironment = {
  production: false,
  convexUrl: 'http://127.0.0.1:3210',
  convexSiteUrl: 'http://127.0.0.1:3211',
  isE2E: false,
  build: {
    commitHash: 'unknown',
    branch: 'unknown',
    timestamp: 'local',
  },
  stripe: {
    publishableKey: '',
    mockPayments: false,
  },
  sentryDsn: '',
  sentryEnvironment: 'development',
  enableSentry: false,
  enableSentryReplay: false,
  sentryReplaySessionSampleRate: 0,
  sentryReplayOnErrorSampleRate: 0,
};

export const environment: AppEnvironment =
  typeof __BRAKET_RUNTIME__ === 'undefined'
    ? fallbackEnvironment
    : __BRAKET_RUNTIME__;
