import {DOCUMENT} from '@angular/common';
import {TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {CONVEX} from 'convex-angular';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import {CheckInService} from './check-in.service';
import {api} from '@convex/_generated/api';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '../../../../testing/mock-types';
import {MockWebHaptics} from '@/testing/mock-web-haptics';
import {WEB_HAPTICS_CTOR} from './web-haptics.token';

interface MockAudioElement {
  src: string;
  currentTime: number;
  muted: boolean;
  volume: number;
  preload: string;
  play: Mock;
  pause: Mock;
  load: Mock;
}

describe('CheckInService', () => {
  let service: CheckInService;
  let convexClientMock: MockConvexClient;
  let audioInstances: MockAudioElement[];
  let AudioMock: Mock;

  beforeEach(() => {
    convexClientMock = createMockConvexClient();
    audioInstances = [];

    AudioMock = vi.fn().mockImplementation(function (
      this: unknown,
      src: string,
    ) {
      const audio: MockAudioElement = {
        src,
        currentTime: 0,
        muted: false,
        volume: 1,
        preload: 'none',
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        load: vi.fn(),
      };
      audioInstances.push(audio);
      return audio as unknown as HTMLAudioElement;
    });

    vi.stubGlobal('Audio', AudioMock);

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        CheckInService,
        {provide: WEB_HAPTICS_CTOR, useValue: MockWebHaptics},
        {provide: CONVEX, useValue: convexClientMock},
        {provide: DOCUMENT, useValue: document},
      ],
    });

    service = TestBed.inject(CheckInService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('initializes success and failure audio assets', () => {
    service.initAudio();

    expect(AudioMock).toHaveBeenCalledWith('/yipee.mp3');
    expect(AudioMock).toHaveBeenCalledWith('/ticketscanfail.mp3');
  });

  it('primes audio on first user gesture so later async playback is less likely to be blocked', async () => {
    service.initAudio();

    document.dispatchEvent(new Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(audioInstances[0].play).toHaveBeenCalled();
    expect(audioInstances[0].pause).toHaveBeenCalled();
    expect(audioInstances[1].play).toHaveBeenCalled();
    expect(audioInstances[1].pause).toHaveBeenCalled();
  });

  it('keeps audio priming listeners attached until priming completes', async () => {
    service.initAudio();

    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
    let resolveSuccessPrime!: () => void;
    let resolveFailurePrime!: () => void;

    audioInstances[0].play.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSuccessPrime = resolve;
      }),
    );
    audioInstances[1].play.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveFailurePrime = resolve;
      }),
    );

    document.dispatchEvent(new Event('click'));
    document.dispatchEvent(new Event('click'));

    expect(audioInstances[0].play).toHaveBeenCalledTimes(1);
    expect(audioInstances[1].play).toHaveBeenCalledTimes(1);
    expect(removeEventListenerSpy).not.toHaveBeenCalled();

    resolveSuccessPrime();
    resolveFailurePrime();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(removeEventListenerSpy).toHaveBeenCalledTimes(4);
  });

  it('plays the success sound after a validated scan', async () => {
    service.initAudio();
    convexClientMock.mutation.mockResolvedValue({
      success: true,
      message: 'Successfully checked in',
    });

    await service.checkIn('ticket-123');

    expect(convexClientMock.mutation).toHaveBeenCalledWith(
      api.events.check_in.checkIn,
      {ticketId: 'ticket-123'},
    );
    expect(audioInstances[0].play).toHaveBeenCalledTimes(1);
    expect(audioInstances[1].play).not.toHaveBeenCalled();
  });

  it('plays the failure sound after a rejected scan', async () => {
    service.initAudio();
    convexClientMock.mutation.mockResolvedValue({
      success: false,
      message: 'Cannot check in',
    });

    await service.checkIn('ticket-123');

    expect(audioInstances[1].play).toHaveBeenCalledTimes(1);
  });

  it('skips audio playback when sounds are muted', async () => {
    service.initAudio();
    service.toggleSoundEnabled();
    convexClientMock.mutation.mockResolvedValue({
      success: true,
      message: 'Successfully checked in',
    });

    await service.checkIn('ticket-123');

    expect(audioInstances[0].play).not.toHaveBeenCalled();
    expect(audioInstances[1].play).not.toHaveBeenCalled();
  });

  it('shows manual audio enable fallback when async playback is blocked', async () => {
    service.initAudio();
    audioInstances[0].play.mockRejectedValueOnce(
      new DOMException('Blocked', 'NotAllowedError'),
    );
    convexClientMock.mutation.mockResolvedValue({
      success: true,
      message: 'Successfully checked in',
    });

    await service.checkIn('ticket-123');

    expect(service.showEnableSoundFallback()).toBe(true);
  });

  it('hides the manual audio enable fallback after a successful manual retry', async () => {
    service.initAudio();
    audioInstances[0].play.mockRejectedValueOnce(
      new DOMException('Blocked', 'NotAllowedError'),
    );
    convexClientMock.mutation.mockResolvedValue({
      success: true,
      message: 'Successfully checked in',
    });

    await service.checkIn('ticket-123');
    await service.enableSoundFromGesture();

    expect(service.showEnableSoundFallback()).toBe(false);
  });
});
