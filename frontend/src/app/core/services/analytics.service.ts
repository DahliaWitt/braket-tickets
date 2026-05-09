import {
  Injectable,
  signal,
  computed,
  type Signal,
  inject,
  effect,
} from '@angular/core';
import type {
  BeforeSendFn,
  CaptureResult,
  PostHogConfig,
  PostHogInterface,
} from 'posthog-js';
import {STORAGE_KEYS} from '../constants/storage.constants';
import {AuthService} from '@/core/services/auth.service';
import {logger} from '@/utils/logger';
import {
  ANALYTICS_RUNTIME_CONFIG,
  type AnalyticsRuntimeConfig,
} from './analytics-config.token';
import {BrowserPlatformService} from './browser-platform.service';
import type {
  AnalyticsEnvironment,
  AnalyticsEventMap,
  AnalyticsEventName,
  FeedbackCategory,
} from '../analytics/events';
import {
  sanitizeAnalyticsProperties,
  sanitizeReplayNetworkRequest,
} from '../analytics/sanitize';
import {toRouteTemplate} from '../analytics/route-template';

export type {FeedbackCategory} from '../analytics/events';

export interface FeedbackCaptureInput {
  category: FeedbackCategory | null;
  message: string;
  route: string;
}

interface PostHogCapturePayload {
  api_key: string;
  event: AnalyticsEventName;
  distinct_id: string;
  properties: Record<string, unknown>;
}

const DEFAULT_POSTHOG_API_HOST = 'https://us.i.posthog.com';
const POSTHOG_SINGLE_EVENT_PATH = '/i/v0/e/';

function getPostHogUiHost(apiHost: string | undefined): string {
  if (
    apiHost?.includes('eu.i.posthog.com') ||
    apiHost?.includes('eu-assets.i.posthog.com')
  ) {
    return 'https://eu.posthog.com';
  }

  return 'https://us.posthog.com';
}

function getPostHogApiHost(apiHost: string | undefined): string {
  return apiHost || DEFAULT_POSTHOG_API_HOST;
}

function getPostHogSingleEventUrl(apiHost: string | undefined): string {
  return `${getPostHogApiHost(apiHost).replace(/\/+$/, '')}${POSTHOG_SINGLE_EVENT_PATH}`;
}

function isAnalyticsEnvironment(value: string): value is AnalyticsEnvironment {
  return (
    value === 'production' ||
    value === 'preview' ||
    value === 'development' ||
    value === 'test' ||
    value === 'e2e'
  );
}

function getAnalyticsEnvironment(
  config: AnalyticsRuntimeConfig,
): AnalyticsEnvironment {
  if (
    typeof config.sentryEnvironment === 'string' &&
    isAnalyticsEnvironment(config.sentryEnvironment)
  ) {
    return config.sentryEnvironment;
  }

  if (config.isE2E) {
    return 'e2e';
  }

  return config.production ? 'production' : 'development';
}

function isLocalhost(hostname: string | undefined): boolean {
  if (!hostname) {
    return false;
  }

  const normalizedHostname = hostname.toLowerCase();

  return (
    normalizedHostname === 'localhost' ||
    normalizedHostname === '127.0.0.1' ||
    normalizedHostname === '0.0.0.0' ||
    normalizedHostname === '[::1]' ||
    normalizedHostname.endsWith('.localhost')
  );
}

function shouldDisableAnalyticsOnHost(): boolean {
  return typeof location !== 'undefined' && isLocalhost(location.hostname);
}

function isEnabledPrivacySignal(value: unknown): boolean {
  return value === true || value === '1' || value === 'yes';
}

function isGlobalPrivacyControlEnabled(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    (navigator as Navigator & {globalPrivacyControl?: boolean})
      .globalPrivacyControl === true
  );
}

function isDoNotTrackEnabled(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const legacyNavigator = navigator as Navigator & {
    msDoNotTrack?: string | null;
  };
  const browserWindow =
    typeof window === 'undefined'
      ? undefined
      : (window as Window & {doNotTrack?: string | null});

  return [
    navigator.doNotTrack,
    legacyNavigator.msDoNotTrack,
    browserWindow?.doNotTrack,
  ].some(isEnabledPrivacySignal);
}

function shouldOptOutAnalyticsByDefault(): boolean {
  return isGlobalPrivacyControlEnabled() || isDoNotTrackEnabled();
}

function toProperties(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  return {...value};
}

function tagEventWithEnvironment(
  event: CaptureResult | null,
  config: AnalyticsRuntimeConfig,
): CaptureResult | null {
  if (!event) {
    return null;
  }

  const originalProperties = toProperties(event.properties);
  const sanitizedProperties = sanitizeAnalyticsProperties(
    {
      ...originalProperties,
      schema_version: 1,
      environment: getAnalyticsEnvironment(config),
      build_commit_hash: config.build.commitHash,
      build_branch: config.build.branch,
      build_timestamp: config.build.timestamp,
      route_template:
        typeof globalThis.location?.pathname === 'string'
          ? toRouteTemplate(globalThis.location.pathname)
          : undefined,
    },
    {
      allowFeedbackMessage: event.event === 'feedback_submitted',
    },
  );

  if (originalProperties['token'] === config.posthog.apiKey) {
    sanitizedProperties['token'] = config.posthog.apiKey;
  }

  return {
    ...event,
    properties: sanitizedProperties,
  };
}

function buildFeedbackProperties(
  input: FeedbackCaptureInput,
  trimmedMessage: string,
  routeTemplate: string,
  signedIn: boolean,
  replayUrl: string | undefined,
  config: AnalyticsRuntimeConfig,
): Record<string, unknown> {
  return sanitizeAnalyticsProperties(
    {
      feedback_category: input.category ?? 'general_feedback',
      feedback_message: trimmedMessage,
      ...(replayUrl ? {feedback_replay_url: replayUrl} : {}),
      message_length: trimmedMessage.length,
      route_template: routeTemplate,
      signed_in: signedIn,
      has_replay_url: Boolean(replayUrl),
      schema_version: 1,
      environment: getAnalyticsEnvironment(config),
      build_commit_hash: config.build.commitHash,
      build_branch: config.build.branch,
      build_timestamp: config.build.timestamp,
      ...(signedIn ? {} : {$process_person_profile: false}),
    },
    {allowFeedbackMessage: true},
  );
}

/**
 * Service for analytics and feature flag management using PostHog.
 *
 * Provides:
 * - Event tracking (`capture`)
 * - User identification and session management (`identify`, `reset`)
 * - Feature flag evaluation with reactive Signal support (`isFeatureEnabled`)
 * - Feature flag payloads (`getFeatureFlagResult`)
 *
 * ## Privacy Compliance
 * - Respects browser's Do Not Track (DNT) setting via `respect_dnt`
 * - Respects DNT/GPC by opting out of capture and persistence when enabled
 * - Uses `identified_only` person profiles to minimize data collection
 *
 * ## Usage
 * ```typescript
 * // Check a feature flag reactively
 * readonly showBetaFeature = this.analytics.isFeatureEnabled('beta-feature');
 *
 * // Track an event
 * this.analytics.capture('checkout_panel_opened', { event_id, checkout_kind });
 * ```
 *
 * @see https://posthog.com/docs
 */
@Injectable({
  providedIn: 'root',
})
export class AnalyticsService {
  private auth = inject(AuthService);
  private readonly runtimeConfig = inject(ANALYTICS_RUNTIME_CONFIG);
  private readonly browser = inject(BrowserPlatformService);
  private readonly client = signal<PostHogInterface | null>(null);
  // Signal to check dependencies against for reactivity
  private readonly flagsChanged = signal<number>(0);
  private initPromise: Promise<PostHogInterface | null> | null = null;
  private readonly analyticsEnvironment = getAnalyticsEnvironment(
    this.runtimeConfig,
  );

  constructor() {
    // Automatically identify/reset user based on auth state
    effect(() => {
      const user = this.auth.currentUser();
      const role = this.auth.userRole();
      const client = this.client();

      if (!client) {
        return;
      }

      if (user) {
        client.identify(user._id, {
          role,
          is_root_admin: role === 'root_admin',
          is_community_admin: role === 'community_admin',
        });
        return;
      }

      client.reset();
    });
  }

  async warmup(): Promise<void> {
    await this.ensureClient();
  }

  private isPostHogEnabled(): boolean {
    return (
      Boolean(this.runtimeConfig.posthog?.apiKey) &&
      !shouldDisableAnalyticsOnHost()
    );
  }

  private async ensureClient(): Promise<PostHogInterface | null> {
    if (!this.isPostHogEnabled()) {
      return null;
    }

    const existingClient = this.client();
    if (existingClient) {
      return existingClient;
    }

    this.initPromise ??= this.loadClient().catch((error: unknown) => {
      this.initPromise = null;
      logger.warn('PostHog initialization failed', error);
      return null;
    });

    return this.initPromise;
  }

  private startClientLoadIfNeeded(): void {
    if (!this.isPostHogEnabled() || this.client()) {
      return;
    }

    void this.ensureClient();
  }

  private async loadClient(): Promise<PostHogInterface> {
    const {default: posthog} = await import('posthog-js');

    const optOutAnalyticsByDefault = shouldOptOutAnalyticsByDefault();

    const config: Partial<PostHogConfig> = {
      api_host: getPostHogApiHost(this.runtimeConfig.posthog.host),
      ui_host: getPostHogUiHost(this.runtimeConfig.posthog.host),
      defaults: '2026-01-30',
      person_profiles: 'identified_only', // Optimizes costs and privacy
      disable_compression: true, // Keep event payloads JSON so the ingest proxy can enrich them.
      respect_dnt: true, // Keep PostHog's built-in DNT guard enabled too.
      mask_all_text: true,
      mask_all_element_attributes: true,
      capture_pageview: 'history_change',
      capture_pageleave: true,
      autocapture: {
        dom_event_allowlist: ['click', 'submit'],
        element_allowlist: ['a', 'button', 'form'],
        css_selector_allowlist: ['[data-analytics]'],
      },
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: '*',
        maskTextFn: (text, element) => {
          const htmlElement = element instanceof HTMLElement ? element : null;
          if (htmlElement?.dataset['record'] === 'true') {
            return text;
          }
          return text.length > 0 ? '[redacted]' : text;
        },
        recordHeaders: false,
        recordBody: false,
        maskCapturedNetworkRequestFn: sanitizeReplayNetworkRequest,
      },
      opt_out_capturing_by_default: optOutAnalyticsByDefault,
      opt_out_persistence_by_default: optOutAnalyticsByDefault,
      before_send: ((event) =>
        tagEventWithEnvironment(
          event,
          this.runtimeConfig,
        )) satisfies BeforeSendFn,
      loaded: (ph) => {
        ph.register({
          environment: this.analyticsEnvironment,
        });
        this.client.set(ph);
        this.flagsChanged.update((v) => v + 1);
        // Register listener for flag changes
        ph.onFeatureFlags(() => {
          this.flagsChanged.update((v) => v + 1);
        });
      },
    };

    posthog.init(this.runtimeConfig.posthog.apiKey, config);

    return posthog;
  }

  /**
   * Returns a Signal<boolean> that indicates if a feature flag is enabled.
   * This signal is reactive and will update when PostHog flags reload.
   * @param flagKey The key of the feature flag in PostHog
   */
  isFeatureEnabled(flagKey: string): Signal<boolean> {
    return computed(() => {
      const normalizedFlagKey = String(flagKey);

      // Register dependency
      this.flagsChanged();

      // If PostHog isn't initialized or key is missing, default to false
      // In E2E mode, we want all features disabled by default for testing
      // In E2E mode, we want all features disabled by default for testing,
      // UNLESS explicitly overridden via localStorage (for testing specific features)
      if (this.runtimeConfig.isE2E) {
        try {
          const e2eOverrides = this.browser.getLocalStorageItem(
            STORAGE_KEYS.E2E_FEATURE_FLAGS,
          );
          if (e2eOverrides) {
            let parsedOverrides: unknown;
            try {
              parsedOverrides = JSON.parse(e2eOverrides);
            } catch (error) {
              logger.warn(
                'Failed to parse E2E feature flag overrides from localStorage',
                error,
              );
              return false;
            }
            if (
              typeof parsedOverrides === 'object' &&
              parsedOverrides !== null &&
              Reflect.get(parsedOverrides, normalizedFlagKey) === true
            ) {
              return true;
            }
          }
        } catch (error: unknown) {
          logger.warn(
            'Failed to read E2E feature flag overrides from localStorage',
            error,
          );
        }
        return false;
      }

      if (!this.isPostHogEnabled()) {
        return false;
      }

      const client = this.client();
      if (!client) {
        this.startClientLoadIfNeeded();
        return false;
      }

      // posthog.isFeatureEnabled returns boolean | undefined
      return client.isFeatureEnabled(normalizedFlagKey) ?? false;
    });
  }

  /**
   * Capture a custom event
   */
  capture<K extends AnalyticsEventName>(
    eventName: K,
    properties: AnalyticsEventMap[K],
  ): void {
    if (this.isPostHogEnabled()) {
      void this.ensureClient().then((client) =>
        client?.capture(eventName, sanitizeAnalyticsProperties(properties)),
      );
    }
  }

  startFeedbackReplayCapture(): void {
    if (!this.isPostHogEnabled()) {
      return;
    }

    void this.ensureClient().then((client) => {
      client?.startSessionRecording({
        sampling: true,
        linked_flag: true,
        url_trigger: true,
        event_trigger: true,
      });
    });
  }

  async captureFeedback(input: FeedbackCaptureInput): Promise<boolean> {
    const trimmedMessage = input.message.trim();
    if (!trimmedMessage) {
      return false;
    }

    const signedIn = Boolean(this.auth.currentUser());
    const routeTemplate = toRouteTemplate(input.route);

    if (!this.isPostHogEnabled()) {
      return false;
    }

    const client = await this.ensureClient();
    if (!client) {
      return false;
    }

    const replayUrl = this.getCurrentSessionReplayUrl(client);
    const distinctId = client.get_distinct_id();
    if (!distinctId) {
      return false;
    }

    const payload: PostHogCapturePayload = {
      api_key: this.runtimeConfig.posthog.apiKey,
      event: 'feedback_submitted',
      distinct_id: distinctId,
      properties: buildFeedbackProperties(
        input,
        trimmedMessage,
        routeTemplate,
        signedIn,
        replayUrl,
        this.runtimeConfig,
      ),
    };

    try {
      const response = await fetch(
        getPostHogSingleEventUrl(this.runtimeConfig.posthog.host),
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        logger.warn('PostHog feedback capture failed', {
          status: response.status,
        });
        return false;
      }

      return true;
    } catch (error: unknown) {
      logger.warn('PostHog feedback capture failed', error);
      return false;
    }
  }

  private getCurrentSessionReplayUrl(
    client: PostHogInterface,
  ): string | undefined {
    if (!client.sessionRecordingStarted()) {
      return undefined;
    }

    const replayUrl = client.get_session_replay_url({
      withTimestamp: true,
      timestampLookBack: 30,
    });

    return replayUrl || undefined;
  }

  /**
   * Identify a user (e.g., on login)
   */
  identify(
    userId: string,
    properties?: {
      role?: string;
      is_root_admin?: boolean;
      is_community_admin?: boolean;
    },
  ) {
    if (this.isPostHogEnabled()) {
      void this.ensureClient().then((client) =>
        client?.identify(
          userId,
          properties ? sanitizeAnalyticsProperties(properties) : undefined,
        ),
      );
    }
  }

  /**
   * Reset the user session (e.g., on logout)
   */
  reset() {
    if (this.isPostHogEnabled()) {
      void this.ensureClient().then((client) => client?.reset());
    }
  }

  /**
   * Get the payload associated with a feature flag
   */
  getFeatureFlagPayload(flagKey: string): Signal<unknown> {
    return computed(() => {
      const normalizedFlagKey = String(flagKey);
      this.flagsChanged();
      if (!this.isPostHogEnabled()) return null;
      const client = this.client();
      if (!client) {
        this.startClientLoadIfNeeded();
        return null;
      }
      return client.getFeatureFlagResult(normalizedFlagKey)?.payload ?? null;
    });
  }
}
