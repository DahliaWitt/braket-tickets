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

function getPostHogUiHost(apiHost: string | undefined): string {
  if (
    apiHost?.includes('eu.i.posthog.com') ||
    apiHost?.includes('eu-assets.i.posthog.com')
  ) {
    return 'https://eu.posthog.com';
  }

  return 'https://us.posthog.com';
}

function getAnalyticsEnvironment(config: AnalyticsRuntimeConfig): string {
  return (
    config.sentryEnvironment ||
    (config.production ? 'production' : 'development')
  );
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
  const sanitizedProperties = sanitizeAnalyticsProperties({
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
  });

  if (originalProperties['token'] === config.posthog.apiKey) {
    sanitizedProperties['token'] = config.posthog.apiKey;
  }

  return {
    ...event,
    properties: sanitizedProperties,
  };
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
 * - Respects Global Privacy Control (GPC) by opting out when enabled
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

    // Check for Global Privacy Control (GPC) signal
    // https://globalprivacycontrol.github.io/gpc-spec/
    const gpcEnabled =
      typeof navigator !== 'undefined' &&
      (navigator as Navigator & {globalPrivacyControl?: boolean})
        .globalPrivacyControl === true;

    const config: Partial<PostHogConfig> = {
      api_host: this.runtimeConfig.posthog.host || 'https://us.i.posthog.com',
      ui_host: getPostHogUiHost(this.runtimeConfig.posthog.host),
      defaults: '2026-01-30',
      person_profiles: 'identified_only', // Optimizes costs and privacy
      disable_compression: true, // Keep event payloads JSON so the ingest proxy can enrich them.
      respect_dnt: true, // Respect browser's Do Not Track setting
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
      opt_out_capturing_by_default: gpcEnabled, // Opt out if GPC is enabled
      opt_out_persistence_by_default: gpcEnabled, // Don't write cookies/localStorage when GPC is active
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

  captureFeedback(input: FeedbackCaptureInput): void {
    const trimmedMessage = input.message.trim();
    if (!trimmedMessage) {
      return;
    }

    const signedIn = Boolean(this.auth.currentUser());

    this.capture('feedback_submitted', {
      feedback_category: input.category ?? 'general_feedback',
      message_length: trimmedMessage.length,
      signed_in: signedIn,
      has_replay_url: false,
    });
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
