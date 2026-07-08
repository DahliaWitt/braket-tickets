import {DOCUMENT} from '@angular/common';
import {DestroyRef, Injectable, inject, signal} from '@angular/core';
import {injectConvex} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {type Id} from '@convex/_generated/dataModel';
import {type FunctionReturnType} from 'convex/server';
import {logger} from '@/utils/logger';
import {parseQRScanData} from '../pages/check-in/qr-parse';
import {WEB_HAPTICS_CTOR} from './web-haptics.token';

type CheckInResult = FunctionReturnType<typeof api.events.check_in.checkIn> & {
  error?: string;
};

/**
 * Feature-scoped service for check-in operations.
 * Owns processing state, audio/haptics feedback, and the Convex mutation calls.
 * Provided in the check-in component (not root) so it's scoped to the feature.
 */
@Injectable()
export class CheckInService {
  private convex = injectConvex();
  private document = inject(DOCUMENT);
  private readonly webHapticsCtor = inject(WEB_HAPTICS_CTOR);
  private readonly destroyRef = inject(DestroyRef);
  private haptics = new this.webHapticsCtor();
  private successAudio?: HTMLAudioElement;
  private failureAudio?: HTMLAudioElement;
  private audioPrimeCleanup: (() => void)[] = [];
  private isAudioPrimed = false;
  private isAudioPriming = false;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.clearAudioPrimeCleanup();
      this.haptics.destroy();
    });
  }

  readonly isProcessing = signal(false);
  readonly lastResult = signal<CheckInResult | null>(null);
  readonly isSoundEnabled = signal(true);
  readonly showEnableSoundFallback = signal(false);

  initAudio(): void {
    if (typeof Audio === 'undefined' || this.successAudio || this.failureAudio)
      return;

    this.successAudio = this.createAudio('/yipee.mp3');
    this.failureAudio = this.createAudio('/ticketscanfail.mp3');
    this.registerAudioPriming();
  }

  toggleSoundEnabled(): void {
    const nextEnabled = !this.isSoundEnabled();
    this.isSoundEnabled.set(nextEnabled);

    if (!nextEnabled) {
      this.showEnableSoundFallback.set(false);
      return;
    }

    void this.enableSoundFromGesture();
  }

  async enableSoundFromGesture(): Promise<void> {
    if (!this.isSoundEnabled()) {
      this.isSoundEnabled.set(true);
    }

    await this.primeAudioOnGesture();
  }

  /**
   * Check in via QR scan data (ticket ID or guest ID encoded in the scan).
   *
   * `eventId` is the scanned event context. It is forwarded to the mutation so
   * that when native ticket/guest resolution fails, the raw payload can be
   * exact-matched against external (imported) ticket barcodes for THIS event
   * only. Passing it is what enables scanning RA-style external tickets.
   */
  async checkIn(scanData: string, eventId?: string): Promise<void> {
    if (!scanData || this.isProcessing()) return;

    const parsed = parseQRScanData(scanData);
    if (!parsed) return;

    const {ticketId, guestId} = parsed;
    if (!ticketId && !guestId) return;

    this.isProcessing.set(true);
    this.lastResult.set(null);

    try {
      const res = await (ticketId
        ? this.convex.mutation(api.events.check_in.checkIn, {
            ticketId: ticketId as Id<'tickets'>,
            ...(eventId ? {eventId} : {}),
          })
        : this.convex.mutation(api.events.check_in.checkIn, {
            guestId: guestId as Id<'guests'>,
            ...(eventId ? {eventId} : {}),
          }));

      this.lastResult.set(res);

      if (res.success) {
        this.playSuccess();
      } else {
        this.playFailure();
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      this.lastResult.set({
        success: false,
        message: `Error: ${errorMessage}`,
      });
      this.playFailure();
    } finally {
      this.isProcessing.set(false);
    }
  }

  /** Check in a guest directly by ID (from the guest list tap). */
  async checkInGuest(guestId: string): Promise<void> {
    if (this.isProcessing()) return;
    this.isProcessing.set(true);
    this.lastResult.set(null);

    try {
      const res = await this.convex.mutation(api.events.check_in.checkIn, {
        guestId: guestId as Id<'guests'>,
      });
      this.lastResult.set(res);

      if (res.success) {
        void this.haptics.trigger('medium');
        this.playSuccess();
      } else {
        this.playFailure();
      }
    } catch (err) {
      logger.error('Operation failed', err);
      this.lastResult.set({
        success: false,
        message:
          err instanceof Error ? err.message : 'Failed to check in guest',
      });
      this.playFailure();
    } finally {
      this.isProcessing.set(false);
    }
  }

  /**
   * Check in an external (imported) ticket holder directly by id, from the
   * imported roster tap. Mirrors the guest path: idempotent on the backend
   * (an already-checked-in entry returns its existing state), plays the same
   * audio/haptic feedback. Returns the raw result so the caller can update the
   * roster row and feedback.
   */
  async checkInImported(
    id: string,
  ): Promise<FunctionReturnType<
    typeof api.events.imported_tickets.checkIn
  > | null> {
    if (this.isProcessing()) return null;
    this.isProcessing.set(true);

    try {
      const res = await this.convex.mutation(
        api.events.imported_tickets.checkIn,
        {id: id as Id<'importedTicketHolders'>},
      );

      if (res.success) {
        void this.haptics.trigger('medium');
        this.playSuccess();
      } else {
        this.playFailure();
      }
      return res;
    } catch (err) {
      logger.error('Operation failed', err);
      this.playFailure();
      return {
        success: false,
        message:
          err instanceof Error
            ? err.message
            : 'Failed to check in external ticket holder',
      };
    } finally {
      this.isProcessing.set(false);
    }
  }

  triggerHaptic(): void {
    void this.haptics.trigger('medium');
  }

  private playSuccess(): void {
    if (!this.isSoundEnabled()) return;

    if (this.successAudio) {
      this.successAudio.currentTime = 0;
      this.successAudio.play().then(
        () => {
          this.showEnableSoundFallback.set(false);
        },
        (err) => {
          this.handlePlaybackFailure(err, 'success');
        },
      );
    }
  }

  private playFailure(): void {
    if (!this.isSoundEnabled()) return;

    if (this.failureAudio) {
      this.failureAudio.currentTime = 0;
      this.failureAudio.play().then(
        () => {
          this.showEnableSoundFallback.set(false);
        },
        (err) => {
          this.handlePlaybackFailure(err, 'failure');
        },
      );
    }
  }

  private createAudio(src: string): HTMLAudioElement {
    const audio = new Audio(src);
    audio.preload = 'auto';
    return audio;
  }

  private registerAudioPriming(): void {
    if (this.isAudioPrimed || this.audioPrimeCleanup.length > 0) return;

    const primeAudioOnGesture = () => {
      void this.primeAudioOnGesture();
    };

    for (const eventName of [
      'pointerdown',
      'touchend',
      'keydown',
      'click',
    ] as const) {
      this.document.addEventListener(eventName, primeAudioOnGesture, true);
      this.audioPrimeCleanup.push(() => {
        this.document.removeEventListener(eventName, primeAudioOnGesture, true);
      });
    }
  }

  private clearAudioPrimeCleanup(): void {
    for (const cleanup of this.audioPrimeCleanup) {
      cleanup();
    }
    this.audioPrimeCleanup = [];
  }

  private async primeAudioOnGesture(): Promise<void> {
    if (this.isAudioPrimed || this.isAudioPriming) return;

    this.isAudioPriming = true;

    try {
      await Promise.all([
        this.primeAudioElement(this.successAudio, 'success'),
        this.primeAudioElement(this.failureAudio, 'failure'),
      ]);
      this.isAudioPrimed = true;
      this.showEnableSoundFallback.set(false);
      this.clearAudioPrimeCleanup();
    } finally {
      this.isAudioPriming = false;
    }
  }

  private async primeAudioElement(
    audio: HTMLAudioElement | undefined,
    audioType: 'success' | 'failure',
  ): Promise<void> {
    if (!audio) return;

    const previousMuted = audio.muted;
    const previousVolume = audio.volume;
    const previousTime = audio.currentTime;

    audio.muted = true;
    audio.volume = 0;

    try {
      await audio.play();
      audio.pause();
    } catch (err) {
      logger.warn('Audio priming failed', {
        audioType,
        src: audio.src,
        error: err,
      });
      return;
    } finally {
      audio.muted = previousMuted;
      audio.volume = previousVolume;
      audio.currentTime = previousTime;
    }
  }

  private handlePlaybackFailure(
    err: unknown,
    audioType: 'success' | 'failure',
  ): void {
    if (this.shouldShowEnableSoundFallback(err)) {
      this.isAudioPrimed = false;
      this.showEnableSoundFallback.set(true);
      this.registerAudioPriming();
    }

    logger.warn('Scanner audio playback rejected', {
      audioType,
      error: err,
    });
  }

  private shouldShowEnableSoundFallback(err: unknown): boolean {
    if (!this.isSoundEnabled()) return false;

    if (err instanceof DOMException) {
      return err.name === 'NotAllowedError' || err.name === 'AbortError';
    }

    if (err instanceof Error) {
      const message = err.message.toLowerCase();
      return (
        message.includes('gesture') ||
        message.includes('user') ||
        message.includes('notallowed')
      );
    }

    return false;
  }
}
