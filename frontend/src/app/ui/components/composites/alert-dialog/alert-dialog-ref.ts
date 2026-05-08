import type {OverlayRef} from '@angular/cdk/overlay';

import {filter, Subject, takeUntil} from 'rxjs';

import {noopFn} from '@ui/utils/noop';

import type {
  BraAlertDialogComponent,
  BraAlertDialogOptions,
} from './alert-dialog.component';

export class BraAlertDialogRef<T = unknown> {
  private readonly destroy$ = new Subject<void>();
  private isClosing = false;

  componentInstance?: T;

  constructor(
    private readonly overlayRef: OverlayRef,
    private readonly config: BraAlertDialogOptions<T>,
    private readonly containerInstance: BraAlertDialogComponent<T>,
    private readonly releaseDocumentInert: () => void = noopFn,
  ) {
    // OutputEmitterRef subscriptions are automatically cleaned up when the component is destroyed
    containerInstance.cancelTriggered.subscribe(() => this.handleCancel());
    containerInstance.okTriggered.subscribe(() => this.handleOk());

    this.handleMaskClick();
    this.handleEscapeKey();
  }

  close(): void {
    if (this.isClosing) {
      return;
    }
    this.isClosing = true;

    const element = this.containerInstance.getNativeElement?.() ?? null;
    if (element) {
      element.classList.add('alert-dialog-leave');
    }
    this.waitForTransitionEnd(element)
      .then(() => this.dispose())
      .catch(noopFn);
  }

  private handleCancel(): void {
    this.handleAction(this.config.zOnCancel);
  }

  private handleOk(): void {
    this.handleAction(this.config.zOnOk);
  }

  private handleMaskClick(): void {
    const hasMaskClosable = this.config.zMaskClosable ?? true;
    if (hasMaskClosable) {
      this.overlayRef
        .outsidePointerEvents()
        .pipe(takeUntil(this.destroy$))
        .subscribe(() => this.close());
    }
  }

  private handleEscapeKey(): void {
    this.overlayRef
      .keydownEvents()
      .pipe(
        filter((event) => event.key === 'Escape'),
        takeUntil(this.destroy$),
      )
      .subscribe(() => this.handleCancel());
  }

  private handleAction(callback: BraAlertDialogOptions<T>['zOnCancel']): void {
    if (this.isClosing) {
      return;
    }

    if (typeof callback === 'function') {
      const result = callback(this.componentInstance as T);
      if (result !== false) {
        this.close();
      }
      return;
    }

    this.close();
  }

  private async waitForTransitionEnd(
    element: HTMLElement | null,
  ): Promise<void> {
    if (!element) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return;
    }

    await Promise.race([
      new Promise<void>((resolve) => {
        const handler = () => {
          element.removeEventListener('transitionend', handler);
          resolve();
        };
        element.addEventListener('transitionend', handler, {once: true});
      }),
      new Promise((resolve) => setTimeout(resolve, 150)),
    ]);
  }

  private dispose(): void {
    this.releaseDocumentInert();

    try {
      this.overlayRef?.dispose();
    } catch {
      // Overlay already destroyed or SSR
    }

    if (!this.destroy$.closed) {
      this.destroy$.next();
      this.destroy$.complete();
    }
  }
}
