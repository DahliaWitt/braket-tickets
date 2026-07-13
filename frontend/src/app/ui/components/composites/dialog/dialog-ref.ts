import type {OverlayRef} from '@angular/cdk/overlay';
import {isPlatformBrowser} from '@angular/common';
import {Inject, PLATFORM_ID} from '@angular/core';

import {filter, map, Subject, takeUntil} from 'rxjs';

import type {BraDialogComponent, BraDialogOptions} from './dialog.component';

const enum eTriggerAction {
  CANCEL = 'cancel',
  OK = 'ok',
}

const DIALOG_CLOSE_FALLBACK_MS = 150;

export class BraDialogRef<T = unknown, R = unknown, U = unknown> {
  private destroy$ = new Subject<void>();
  private isClosing = false;
  protected result?: R;
  componentInstance: T | null = null; // T is the Component Type
  readonly afterClosed$ = this.destroy$.pipe(map(() => this.result));

  constructor(
    private overlayRef: OverlayRef,
    private config: BraDialogOptions<T, U>,
    private containerInstance: BraDialogComponent<T, U>,
    @Inject(PLATFORM_ID) private platformId: object,
    private readonly releaseDocumentInert: () => void = () => undefined,
  ) {
    // OutputEmitterRef subscriptions are automatically cleaned up when the component is destroyed
    this.containerInstance.cancelTriggered.subscribe(() =>
      this.trigger(eTriggerAction.CANCEL),
    );
    this.containerInstance.okTriggered.subscribe(() =>
      this.trigger(eTriggerAction.OK),
    );

    if (
      (this.config.zMaskClosable ?? true) &&
      isPlatformBrowser(this.platformId)
    ) {
      this.overlayRef
        .outsidePointerEvents()
        .pipe(takeUntil(this.destroy$))
        .subscribe(() => this.close());
    }

    // Subscribe to the overlay's own keydown stream instead of a raw document
    // listener so CDK's OverlayKeyboardDispatcher only delivers Escape to the
    // topmost overlay. This lets an inner overlay (e.g. an open z-select
    // dropdown) or a stacked dialog handle Escape first, and closes only the
    // topmost dialog. On the server the overlay ref is a no-op emitting EMPTY.
    this.overlayRef
      .keydownEvents()
      .pipe(
        filter((event) => event.key === 'Escape'),
        takeUntil(this.destroy$),
      )
      .subscribe(() => this.close());
  }

  close(result?: R) {
    if (this.isClosing) {
      return;
    }

    this.isClosing = true;
    this.result = result;

    let hostElement: HTMLElement | null = null;

    if (isPlatformBrowser(this.platformId)) {
      hostElement = this.containerInstance.getNativeElement();
      hostElement.classList.add('dialog-leave');
    }

    void this.waitForCloseTransition(hostElement).then(() => this.dispose());
  }

  private trigger(action: eTriggerAction) {
    const trigger = {ok: this.config.zOnOk, cancel: this.config.zOnCancel}[
      action
    ];

    if (typeof trigger === 'function') {
      const result = trigger(this.getContentComponent()) as R;
      this.closeWithResult(result);
    } else {
      this.close();
    }
  }

  private getContentComponent(): T {
    return this.componentInstance as T;
  }

  private closeWithResult(result: R): void {
    if (result !== false) {
      this.close(result);
    }
  }

  private waitForCloseTransition(
    hostElement: HTMLElement | null,
  ): Promise<void> {
    return new Promise((resolve) => {
      if (!hostElement) {
        // Keep a bounded timer fallback for SSR and missing-host cases where no transition can fire.
        setTimeout(resolve, DIALOG_CLOSE_FALLBACK_MS);
        return;
      }

      const handleTransitionEnd = (event: Event) => {
        if (event.target !== hostElement) {
          return;
        }

        finish();
      };

      const finish = () => {
        clearTimeout(fallbackTimeoutId);
        hostElement.removeEventListener('transitionend', handleTransitionEnd);
        resolve();
      };

      hostElement.addEventListener('transitionend', handleTransitionEnd);
      // Keep a bounded timer fallback for interrupted transitions or test environments that skip events.
      const fallbackTimeoutId = setTimeout(finish, DIALOG_CLOSE_FALLBACK_MS);
    });
  }

  private dispose(): void {
    this.releaseDocumentInert();

    if (this.overlayRef) {
      if (this.overlayRef.hasAttached()) {
        this.overlayRef.detachBackdrop();
      }
      this.overlayRef.dispose();
    }

    if (!this.destroy$.closed) {
      this.destroy$.next();
      this.destroy$.complete();
    }
  }
}
