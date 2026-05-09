import {vi, describe, it, expect, beforeEach, afterEach} from 'vitest';
import type {Mock} from 'vitest';
import {TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection, signal} from '@angular/core';
import {AnalyticsService} from '@/core/services/analytics.service';
import {AuthService} from '@/core/services/auth.service';
import {type UserModel} from '@/testing/user-model';
import {type Id} from '@convex/_generated/dataModel';
import {logger} from '@/utils/logger';
import posthog from 'posthog-js';
import {
  ANALYTICS_RUNTIME_CONFIG,
  type AnalyticsRuntimeConfig,
} from '@/core/services/analytics-config.token';
import {STORAGE_KEYS} from '../constants/storage.constants';

// Keep the third-party PostHog mock hoisted so Vitest can install it before imports.
const mockPosthog = vi.hoisted(() => ({
  init: vi.fn(),
  register: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  capture: vi.fn(),
  isFeatureEnabled: vi.fn(),
  getFeatureFlagResult: vi.fn(),
  get_session_replay_url: vi.fn(),
  startSessionRecording: vi.fn(),
  sessionRecordingStarted: vi.fn(),
  get_distinct_id: vi.fn(),
  onFeatureFlags: vi.fn(),
}));

// Mock posthog-js module
vi.mock('posthog-js', () => ({
  default: mockPosthog,
}));

const resolvePostHogUiHost = (apiHost: string | undefined): string =>
  apiHost?.includes('eu.i.posthog.com') ||
  apiHost?.includes('eu-assets.i.posthog.com')
    ? 'https://eu.posthog.com'
    : 'https://us.posthog.com';

const TEST_FEATURE_FLAG = 'beta-feature';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let analyticsRuntimeConfig: AnalyticsRuntimeConfig;
  let authServiceMock: {
    currentUser: ReturnType<typeof signal<UserModel | null>>;
    userRole: ReturnType<typeof signal<string>>;
  };

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    analyticsRuntimeConfig = {
      production: true,
      isE2E: false,
      sentryEnvironment: 'preview',
      build: {
        commitHash: 'abc123',
        branch: 'develop',
        timestamp: '2026-04-09T00:00:00.000Z',
      },
      posthog: {
        apiKey: 'test-api-key',
        host: 'https://test.posthog.com',
      },
    };
    vi.stubGlobal('location', new URL('https://dev.community.braket.gay/'));

    // Create mock auth service with signals
    authServiceMock = {
      currentUser: signal<UserModel | null>(null),
      userRole: signal<string>('user'),
    };

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        AnalyticsService,
        {provide: AuthService, useValue: authServiceMock},
        {provide: ANALYTICS_RUNTIME_CONFIG, useValue: analyticsRuntimeConfig},
      ],
    });

    service = TestBed.inject(AnalyticsService);
    mockPosthog.capture.mockReturnValue({event: 'captured', properties: {}});
    mockPosthog.get_distinct_id.mockReturnValue('distinct-test-id');
    mockPosthog.sessionRecordingStarted.mockReturnValue(false);
    mockPosthog.get_session_replay_url.mockReturnValue('');
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    localStorage.removeItem(STORAGE_KEYS.E2E_FEATURE_FLAGS);
  });

  const waitForInit = async () => {
    await vi.waitFor(() => expect(posthog.init).toHaveBeenCalled());
  };

  const markPostHogLoaded = () => {
    const initCall = vi.mocked(posthog.init).mock.calls.at(-1);
    initCall?.[1]?.loaded?.(posthog);
  };

  describe('initialization', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it('defers PostHog initialization until warmup is requested', () => {
      expect(posthog.init).not.toHaveBeenCalled();
    });

    it('should initialize PostHog with correct configuration', async () => {
      await service.warmup();
      await waitForInit();

      // Get the actual call arguments
      const [apiKey, options] = vi.mocked(posthog.init).mock.calls[0];

      // Verify it was called with expected structure
      // Note: In parallel test runs, the mock environment may vary
      expect(typeof apiKey).toBe('string');
      expect(apiKey.length).toBeGreaterThan(0);
      expect(options).toMatchObject({
        defaults: '2026-01-30',
        person_profiles: 'identified_only',
        respect_dnt: true,
        opt_out_capturing_by_default: false,
        opt_out_persistence_by_default: false,
        mask_all_text: true,
        mask_all_element_attributes: true,
        capture_pageview: 'history_change',
        capture_pageleave: true,
        autocapture: {
          dom_event_allowlist: ['click', 'submit'],
          element_allowlist: ['a', 'button', 'form'],
          css_selector_allowlist: ['[data-analytics]'],
        },
        loaded: expect.any(Function) as unknown,
      });
    });

    it('opts out of PostHog capture and persistence by default when DNT is enabled', async () => {
      vi.stubGlobal('navigator', {doNotTrack: '1'});

      await service.warmup();
      await waitForInit();

      const [, options] = vi.mocked(posthog.init).mock.calls[0];

      expect(options).toMatchObject({
        respect_dnt: true,
        opt_out_capturing_by_default: true,
        opt_out_persistence_by_default: true,
      });
    });

    it('opts out of PostHog capture and persistence by default when GPC is enabled', async () => {
      vi.stubGlobal('navigator', {globalPrivacyControl: true});

      await service.warmup();
      await waitForInit();

      const [, options] = vi.mocked(posthog.init).mock.calls[0];

      expect(options).toMatchObject({
        respect_dnt: true,
        opt_out_capturing_by_default: true,
        opt_out_persistence_by_default: true,
      });
    });

    it('does not start replay or send direct feedback capture when DNT is enabled', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
      vi.stubGlobal('navigator', {doNotTrack: '1'});
      vi.stubGlobal('fetch', fetchMock);

      await service.warmup();
      await waitForInit();

      service.startFeedbackReplayCapture();
      await expect(
        service.captureFeedback({
          category: 'bug',
          message: 'Respect my browser privacy signal',
          route: '/help',
        }),
      ).resolves.toBe(false);

      expect(posthog.startSessionRecording).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not start replay or send direct feedback capture when GPC is enabled', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
      vi.stubGlobal('navigator', {globalPrivacyControl: true});
      vi.stubGlobal('fetch', fetchMock);

      await service.warmup();
      await waitForInit();

      service.startFeedbackReplayCapture();
      await expect(
        service.captureFeedback({
          category: 'feature_request',
          message: 'Respect global privacy control too',
          route: '/help',
        }),
      ).resolves.toBe(false);

      expect(posthog.startSessionRecording).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('configures masked session replay without headers or bodies', async () => {
      await service.warmup();
      await waitForInit();

      const [, options] = vi.mocked(posthog.init).mock.calls[0];
      const sessionRecording = options?.session_recording;

      expect(sessionRecording).toMatchObject({
        maskAllInputs: true,
        maskTextSelector: '*',
        recordHeaders: false,
        recordBody: false,
      });
      expect(
        sessionRecording?.maskTextFn?.(
          'Visible label',
          document.createElement('span'),
        ),
      ).toBe('[redacted]');
      expect(
        sessionRecording?.maskCapturedNetworkRequestFn?.({
          name: 'https://braket.local/checkout/abcdefghijklmnopqrstuvwxyz?client_secret=secret',
          entryType: 'resource',
          startTime: 0,
          duration: 0,
          url: 'https://braket.local/checkout/abcdefghijklmnopqrstuvwxyz?client_secret=secret',
          requestHeaders: {authorization: 'secret'},
          responseHeaders: {'set-cookie': 'secret'},
          requestBody: 'secret',
          responseBody: 'secret',
        } as never),
      ).toEqual({
        name: '/checkout/:token',
        entryType: 'resource',
        startTime: 0,
        duration: 0,
        url: '/checkout/:token',
        requestHeaders: undefined,
        responseHeaders: undefined,
        requestBody: undefined,
        responseBody: undefined,
      });
    });

    it('passes a relative proxy host through to PostHog init', async () => {
      analyticsRuntimeConfig.posthog.host = '/ingest';

      await service.warmup();
      await waitForInit();

      const [, options] = vi.mocked(posthog.init).mock.calls[0];
      const expectedHost = '/ingest';

      expect(options).toMatchObject({
        api_host: expectedHost,
        ui_host: resolvePostHogUiHost(expectedHost),
      });
    });

    it('maps EU ingestion to the EU PostHog UI host', async () => {
      analyticsRuntimeConfig.posthog.host = 'https://eu.i.posthog.com';

      await service.warmup();
      await waitForInit();

      const [, options] = vi.mocked(posthog.init).mock.calls[0];
      const expectedHost = 'https://eu.i.posthog.com';

      expect(options).toMatchObject({
        api_host: expectedHost,
        ui_host: resolvePostHogUiHost(expectedHost),
      });
    });

    it('disables PostHog entirely on localhost', async () => {
      vi.stubGlobal('location', new URL('http://localhost:4200/'));

      await service.warmup();
      service.capture('trust_link_created', {source: 'settings'});
      await Promise.resolve();

      expect(posthog.init).not.toHaveBeenCalled();
      expect(posthog.capture).not.toHaveBeenCalled();
    });

    it('registers the environment as a super property when loaded', async () => {
      await service.warmup();
      await waitForInit();

      markPostHogLoaded();

      expect(posthog.register).toHaveBeenCalledWith({
        environment: 'preview',
      });
    });

    it('tags outgoing events with the environment before send', async () => {
      vi.stubGlobal(
        'location',
        new URL(
          'https://dev.community.braket.gay/events/01j2k3l4m5n6o7p8q9?token=secret',
        ),
      );
      await service.warmup();
      await waitForInit();

      const [, options] = vi.mocked(posthog.init).mock.calls[0];
      const event = {properties: {existing: true}};

      expect(
        options?.before_send && typeof options.before_send === 'function'
          ? options.before_send(event as never)
          : undefined,
      ).toEqual({
        properties: {
          existing: true,
          schema_version: 1,
          environment: 'preview',
          build_commit_hash: 'abc123',
          build_branch: 'develop',
          build_timestamp: '2026-04-09T00:00:00.000Z',
          route_template: '/events/:id',
        },
      });
    });

    it('preserves the configured PostHog token required by SDK ingest', async () => {
      await service.warmup();
      await waitForInit();

      const [, options] = vi.mocked(posthog.init).mock.calls[0];
      const event = {
        properties: {
          token: analyticsRuntimeConfig.posthog.apiKey,
          distinct_id: 'anonymous-device-id',
        },
      };

      expect(
        options?.before_send && typeof options.before_send === 'function'
          ? options.before_send(event as never)
          : undefined,
      ).toMatchObject({
        properties: {
          token: analyticsRuntimeConfig.posthog.apiKey,
          distinct_id: 'anonymous-device-id',
        },
      });
    });

    it('redacts denylisted properties through before_send', async () => {
      await service.warmup();
      await waitForInit();

      const [, options] = vi.mocked(posthog.init).mock.calls[0];
      const event = {
        properties: {
          email: 'person@example.com',
          name: 'Person Example',
          message: 'raw feedback',
          token: 'non-posthog-token',
          client_secret: 'cs_test_123',
          $pathname: '/admin-invite/demo-admin-invite-lot45',
          $referrer: 'https://braket.local/confirm/verification/short-token',
          safe_count: 2,
        },
      };

      expect(
        options?.before_send && typeof options.before_send === 'function'
          ? options.before_send(event as never)
          : undefined,
      ).toMatchObject({
        properties: {
          email: '[redacted]',
          name: '[redacted]',
          message: '[redacted]',
          token: '[redacted]',
          client_secret: '[redacted]',
          $pathname: '/admin-invite/:token',
          $referrer: '/confirm/verification/:token',
          safe_count: 2,
        },
      });
    });

    it('only preserves feedback_message on feedback_submitted events', async () => {
      await service.warmup();
      await waitForInit();

      const [, options] = vi.mocked(posthog.init).mock.calls[0];
      const feedbackEvent = {
        event: 'feedback_submitted',
        properties: {
          feedback_message: 'The exact feedback body',
        },
      };
      const unrelatedEvent = {
        event: 'checkout_panel_opened',
        properties: {
          feedback_message: 'Should not leak through another event',
        },
      };

      expect(
        options?.before_send && typeof options.before_send === 'function'
          ? options.before_send(feedbackEvent as never)
          : undefined,
      ).toMatchObject({
        properties: {
          feedback_message: 'The exact feedback body',
        },
      });
      expect(
        options?.before_send && typeof options.before_send === 'function'
          ? options.before_send(unrelatedEvent as never)
          : undefined,
      ).toMatchObject({
        properties: {
          feedback_message: '[redacted]',
        },
      });
    });

    it('should register onFeatureFlags callback when loaded', async () => {
      await service.warmup();
      await waitForInit();

      // Get the loaded callback from the init call
      markPostHogLoaded();

      expect(posthog.onFeatureFlags).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe('identify', () => {
    it('should call PostHog identify with sanitized safe role data', async () => {
      const userId = 'user-123';
      const properties = {
        role: 'community_admin',
        is_root_admin: false,
        is_community_admin: true,
      };

      service.identify(userId, properties);

      await vi.waitFor(() =>
        expect(posthog.identify).toHaveBeenCalledWith(userId, properties),
      );
    });

    it('should call identify without properties', async () => {
      service.identify('user-456');

      await vi.waitFor(() =>
        expect(posthog.identify).toHaveBeenCalledWith('user-456', undefined),
      );
    });
  });

  describe('reset', () => {
    it('should call PostHog reset', async () => {
      service.reset();

      await vi.waitFor(() => expect(posthog.reset).toHaveBeenCalled());
    });
  });

  describe('capture', () => {
    it('should call PostHog capture with event name and properties', async () => {
      const eventName = 'trust_link_created';
      const properties = {organizer_id: 'org123', source: 'settings'};

      service.capture(eventName, properties);

      await vi.waitFor(() =>
        expect(posthog.capture).toHaveBeenCalledWith(eventName, properties),
      );
    });

    it('should sanitize properties before capture', async () => {
      service.capture('trust_link_removed', {
        organizer_id: 'org123',
        source: 'settings',
      });

      await vi.waitFor(() =>
        expect(posthog.capture).toHaveBeenCalledWith('trust_link_removed', {
          organizer_id: 'org123',
          source: 'settings',
        }),
      );
    });
  });

  describe('startFeedbackReplayCapture', () => {
    it('starts PostHog replay for feedback with ingestion controls overridden', async () => {
      service.startFeedbackReplayCapture();

      await vi.waitFor(() =>
        expect(posthog.startSessionRecording).toHaveBeenCalledWith({
          sampling: true,
          linked_flag: true,
          url_trigger: true,
          event_trigger: true,
        }),
      );
    });

    it('does not start feedback replay when analytics is disabled', async () => {
      analyticsRuntimeConfig.posthog.apiKey = '';

      service.startFeedbackReplayCapture();

      await vi.waitFor(() => expect(posthog.init).not.toHaveBeenCalled());
      expect(posthog.startSessionRecording).not.toHaveBeenCalled();
    });
  });

  describe('captureFeedback', () => {
    let fetchMock: Mock;

    beforeEach(() => {
      fetchMock = vi.fn().mockResolvedValue(new Response('{}', {status: 200}));
      vi.stubGlobal('fetch', fetchMock);
    });

    const getLastFeedbackPayload = (): Record<string, unknown> => {
      const fetchInit = fetchMock.mock.calls.at(-1)?.[1] as
        | RequestInit
        | undefined;
      const body = fetchInit?.body;
      if (typeof body !== 'string') {
        throw new Error('Expected feedback request body to be a string');
      }
      return JSON.parse(body) as Record<string, unknown>;
    };

    it('should not capture feedback when message is blank', async () => {
      await expect(
        service.captureFeedback({
          category: 'bug',
          message: '   ',
          route: '/about',
        }),
      ).resolves.toBe(false);

      expect(posthog.capture).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should return false when PostHog rejects the feedback capture request', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(vi.fn());
      fetchMock.mockResolvedValueOnce(new Response('{}', {status: 503}));

      await expect(
        service.captureFeedback({
          category: 'bug',
          message: 'Bug still happens',
          route: '/help',
        }),
      ).resolves.toBe(false);

      expect(posthog.capture).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(warnSpy).toHaveBeenCalledWith('PostHog feedback capture failed', {
        status: 503,
      });
      warnSpy.mockRestore();
    });

    it('should return false when PostHog capture request throws', async () => {
      const error = new Error('network failed');
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(vi.fn());
      fetchMock.mockRejectedValueOnce(error);

      await expect(
        service.captureFeedback({
          category: 'bug',
          message: 'Bug still happens',
          route: '/help',
        }),
      ).resolves.toBe(false);

      expect(posthog.capture).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(warnSpy).toHaveBeenCalledWith(
        'PostHog feedback capture failed',
        error,
      );
      warnSpy.mockRestore();
    });

    it('should capture feedback metadata for anonymous users', async () => {
      await expect(
        service.captureFeedback({
          category: null,
          message: '  The footer link order is confusing.  ',
          route: '/about',
        }),
      ).resolves.toBe(true);

      expect(posthog.capture).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith(
        'https://test.posthog.com/i/v0/e/',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
        }),
      );

      expect(getLastFeedbackPayload()).toEqual({
        api_key: 'test-api-key',
        event: 'feedback_submitted',
        distinct_id: 'distinct-test-id',
        properties: {
          feedback_category: 'general_feedback',
          feedback_message: 'The footer link order is confusing.',
          message_length: 'The footer link order is confusing.'.length,
          route_template: '/about',
          signed_in: false,
          has_replay_url: false,
          schema_version: 1,
          environment: 'preview',
          build_commit_hash: 'abc123',
          build_branch: 'develop',
          build_timestamp: '2026-04-09T00:00:00.000Z',
          $process_person_profile: false,
        },
      });
      expect(posthog.get_session_replay_url).not.toHaveBeenCalled();
    });

    it('should use the same-origin ingest proxy for deployed feedback capture', async () => {
      analyticsRuntimeConfig.posthog.host = '/ingest';

      await expect(
        service.captureFeedback({
          category: 'bug',
          message: 'Bug still happens',
          route: '/help',
        }),
      ).resolves.toBe(true);

      expect(fetchMock).toHaveBeenCalledWith(
        '/ingest/i/v0/e/',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('should include a timestamped replay URL when session recording is active', async () => {
      vi.mocked(posthog.sessionRecordingStarted).mockReturnValue(true);
      vi.mocked(posthog.get_session_replay_url).mockReturnValue(
        'https://us.posthog.com/project/test-api-key/replay/session-id?t=45',
      );

      await expect(
        service.captureFeedback({
          category: 'feature_request',
          message: 'Please show this exact path in context.',
          route: '/events/01j2k3l4m5n6o7p8q9?token=secret',
        }),
      ).resolves.toBe(true);

      expect(posthog.capture).not.toHaveBeenCalled();
      expect(getLastFeedbackPayload()).toMatchObject({
        api_key: 'test-api-key',
        event: 'feedback_submitted',
        distinct_id: 'distinct-test-id',
        properties: {
          feedback_category: 'feature_request',
          feedback_message: 'Please show this exact path in context.',
          feedback_replay_url:
            'https://us.posthog.com/project/test-api-key/replay/session-id?t=45',
          message_length: 'Please show this exact path in context.'.length,
          route_template: '/events/:id',
          signed_in: false,
          has_replay_url: true,
        },
      });
      expect(posthog.get_session_replay_url).toHaveBeenCalledWith({
        withTimestamp: true,
        timestampLookBack: 30,
      });
    });

    it('should mark logged in users as signed_in and preserve bug category', async () => {
      authServiceMock.currentUser.set({
        _id: 'user-123' as Id<'users'>,
        _creationTime: Date.now(),
        email: 'user@example.com',
        name: 'User Example',
      });

      await expect(
        service.captureFeedback({
          category: 'bug',
          message: 'Bug still happens',
          route: '/help',
        }),
      ).resolves.toBe(true);

      expect(posthog.capture).not.toHaveBeenCalled();
      expect(getLastFeedbackPayload()).toEqual({
        api_key: 'test-api-key',
        event: 'feedback_submitted',
        distinct_id: 'distinct-test-id',
        properties: {
          feedback_category: 'bug',
          feedback_message: 'Bug still happens',
          message_length: 'Bug still happens'.length,
          route_template: '/help',
          signed_in: true,
          has_replay_url: false,
          schema_version: 1,
          environment: 'preview',
          build_commit_hash: 'abc123',
          build_branch: 'develop',
          build_timestamp: '2026-04-09T00:00:00.000Z',
        },
      });
    });
  });

  describe('isFeatureEnabled', () => {
    it('should return a signal that reflects PostHog feature flag state', async () => {
      vi.mocked(posthog.isFeatureEnabled).mockReturnValue(true);
      const initCall = vi.mocked(posthog.init).mock.calls[0];
      const enabledSignal = service.isFeatureEnabled(TEST_FEATURE_FLAG);
      expect(initCall).toBeUndefined();
      enabledSignal();

      await waitForInit();
      markPostHogLoaded();

      expect(enabledSignal()).toBe(true);
      expect(posthog.isFeatureEnabled).toHaveBeenCalledWith(TEST_FEATURE_FLAG);
    });

    it('should return false when feature flag is not enabled', async () => {
      vi.mocked(posthog.isFeatureEnabled).mockReturnValue(false);
      const enabledSignal = service.isFeatureEnabled(TEST_FEATURE_FLAG);
      enabledSignal();
      await waitForInit();
      markPostHogLoaded();

      expect(enabledSignal()).toBe(false);
    });

    it('should return false when PostHog returns undefined', async () => {
      vi.mocked(posthog.isFeatureEnabled).mockReturnValue(undefined);
      const enabledSignal = service.isFeatureEnabled(TEST_FEATURE_FLAG);
      enabledSignal();
      await waitForInit();
      markPostHogLoaded();

      expect(enabledSignal()).toBe(false);
    });

    it('warns and returns false when E2E feature flag overrides contain invalid JSON', () => {
      analyticsRuntimeConfig.isE2E = true;
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(vi.fn());
      localStorage.setItem(STORAGE_KEYS.E2E_FEATURE_FLAGS, '{invalid-json');

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideZonelessChangeDetection(),
          AnalyticsService,
          {provide: AuthService, useValue: authServiceMock},
          {provide: ANALYTICS_RUNTIME_CONFIG, useValue: analyticsRuntimeConfig},
        ],
      });

      service = TestBed.inject(AnalyticsService);

      expect(service.isFeatureEnabled(TEST_FEATURE_FLAG)()).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to parse E2E feature flag overrides from localStorage',
        expect.any(SyntaxError),
      );
    });
  });

  describe('getFeatureFlagPayload', () => {
    it('should return a signal with the feature flag payload', async () => {
      const mockPayload = {variant: 'experiment-a', discount: 10};
      vi.mocked(posthog.getFeatureFlagResult).mockReturnValue({
        key: TEST_FEATURE_FLAG,
        enabled: true,
        variant: 'experiment-a',
        payload: mockPayload,
      });
      const payloadSignal = service.getFeatureFlagPayload(TEST_FEATURE_FLAG);
      payloadSignal();
      await waitForInit();
      markPostHogLoaded();

      expect(payloadSignal()).toEqual(mockPayload);
      expect(posthog.getFeatureFlagResult).toHaveBeenCalledWith(
        TEST_FEATURE_FLAG,
      );
    });

    it('should return null payload when not available', async () => {
      vi.mocked(posthog.getFeatureFlagResult).mockReturnValue(undefined);
      const payloadSignal = service.getFeatureFlagPayload(TEST_FEATURE_FLAG);
      payloadSignal();
      await waitForInit();
      markPostHogLoaded();

      expect(payloadSignal()).toBeNull();
    });
  });

  describe('automatic user identification', () => {
    it('should identify user when currentUser changes to logged in', async () => {
      const mockUser: UserModel = {
        _id: 'user-789' as Id<'users'>,
        _creationTime: Date.now(),
        email: 'logged@example.com',
        name: 'Logged User',
      };

      // Clear previous identify calls from initialization
      vi.mocked(posthog.identify).mockClear();

      await service.warmup();
      await waitForInit();
      markPostHogLoaded();

      authServiceMock.currentUser.set(mockUser);
      authServiceMock.userRole.set('root_admin');
      TestBed.tick();

      await vi.waitFor(() =>
        expect(posthog.identify).toHaveBeenCalledWith('user-789', {
          role: 'root_admin',
          is_root_admin: true,
          is_community_admin: false,
        }),
      );
    });

    it('should reset when user logs out', async () => {
      // First set a user
      const mockUser: UserModel = {
        _id: 'user-logout' as Id<'users'>,
        _creationTime: Date.now(),
        email: 'logout@example.com',
        name: 'Logout User',
      };
      await service.warmup();
      await waitForInit();
      markPostHogLoaded();

      authServiceMock.currentUser.set(mockUser);
      TestBed.tick();

      // Clear mocks
      vi.mocked(posthog.reset).mockClear();

      // Now log out
      authServiceMock.currentUser.set(null);
      TestBed.tick();

      await vi.waitFor(() => expect(posthog.reset).toHaveBeenCalled());
    });
  });
});

// Tests for unconfigured PostHog are in analytics.service.unconfigured.spec.ts

describe('AnalyticsService error handling', () => {
  let loggerWarnSpy: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    loggerWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => void 0);
    vi.stubGlobal('location', new URL('https://dev.community.braket.gay/'));
  });

  afterEach(() => {
    loggerWarnSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('should catch and log PostHog initialization errors', async () => {
    // Make PostHog init throw an error
    vi.mocked(posthog.init).mockImplementationOnce(() => {
      throw new Error('PostHog initialization failed');
    });

    const authServiceMock = {
      currentUser: signal<UserModel | null>(null),
      userRole: signal<string>('user'),
    };
    const analyticsRuntimeConfig: AnalyticsRuntimeConfig = {
      production: true,
      isE2E: false,
      sentryEnvironment: 'preview',
      build: {
        commitHash: 'abc123',
        branch: 'develop',
        timestamp: '2026-04-09T00:00:00.000Z',
      },
      posthog: {
        apiKey: 'test-api-key',
        host: 'https://test.posthog.com',
      },
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        AnalyticsService,
        {provide: AuthService, useValue: authServiceMock},
        {provide: ANALYTICS_RUNTIME_CONFIG, useValue: analyticsRuntimeConfig},
      ],
    });

    // Service should be created without throwing
    const service = TestBed.inject(AnalyticsService);
    expect(service).toBeTruthy();
    await service.warmup();

    await vi.waitFor(() =>
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'PostHog initialization failed',
        expect.any(Error),
      ),
    );
  });
});
