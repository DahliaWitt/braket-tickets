import {Overlay, type OverlayRef} from '@angular/cdk/overlay';
import {
  inject,
  Injectable,
  InjectionToken,
  Injector,
  PLATFORM_ID,
} from '@angular/core';
import {EMPTY} from 'rxjs';

import {
  attachDialogContainerInstance,
  attachDialogContent,
  createDialogOverlayRef,
  type BraDialogContentType,
} from '../dialog-core/dialog-service.utils';
import {BraDialogDocumentInertManager} from '../dialog-core/dialog-document-inert-manager';
import {BraAlertDialogRef} from './alert-dialog-ref';
import {
  BraAlertDialogComponent,
  BraAlertDialogOptions,
} from './alert-dialog.component';

export const Z_ALERT_MODAL_DATA = new InjectionToken<unknown>(
  'Z_ALERT_MODAL_DATA',
);

const noopOutput = {
  subscribe: () => ({unsubscribe: () => undefined}),
};

@Injectable({
  providedIn: 'root',
})
export class BraAlertDialogService {
  private readonly overlay = inject(Overlay);
  private readonly injector = inject(Injector);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly inertManager = inject(BraDialogDocumentInertManager);

  create<T>(config: BraAlertDialogOptions<T>): BraAlertDialogRef<T> {
    return this.open<T>(config.zContent, config);
  }

  confirm<T>(
    config: Omit<BraAlertDialogOptions<T>, 'zOkText' | 'zCancelText'> & {
      zOkText?: string;
      zCancelText?: string;
    },
  ): BraAlertDialogRef<T> {
    const confirmConfig: BraAlertDialogOptions<T> = {
      ...config,
      zOkText: config.zOkText ?? 'Confirm',
      zCancelText: config.zCancelText ?? 'Cancel',
      zOkDestructive: config.zOkDestructive ?? false,
    };
    return this.create(confirmConfig);
  }

  warning<T>(
    config: Omit<BraAlertDialogOptions<T>, 'zOkText'> & {zOkText?: string},
  ): BraAlertDialogRef<T> {
    const warningConfig: BraAlertDialogOptions<T> = {
      ...config,
      zOkText: config.zOkText ?? 'OK',
      zCancelText: null,
    };
    return this.create(warningConfig);
  }

  info<T>(
    config: Omit<BraAlertDialogOptions<T>, 'zOkText'> & {zOkText?: string},
  ): BraAlertDialogRef<T> {
    const infoConfig: BraAlertDialogOptions<T> = {
      ...config,
      zOkText: config.zOkText ?? 'OK',
      zCancelText: null,
    };
    return this.create(infoConfig);
  }

  private open<T>(
    componentOrTemplateRef: BraDialogContentType<T>,
    config: BraAlertDialogOptions<T>,
  ) {
    const overlayRef = this.createOverlay();

    if (!overlayRef) {
      return this.createNoopAlertDialogRef(config);
    }

    const releaseDocumentInert = this.inertManager.activate();

    try {
      const alertDialogContainer = this.attachAlertDialogContainer<T>(
        overlayRef,
        config,
      );
      const alertDialogRef = this.attachAlertDialogContent<T>(
        componentOrTemplateRef,
        alertDialogContainer,
        overlayRef,
        config,
        releaseDocumentInert,
      );

      alertDialogContainer.alertDialogRef = alertDialogRef;

      return alertDialogRef;
    } catch (error) {
      releaseDocumentInert();
      this.disposeOverlayRef(overlayRef);
      throw error;
    }
  }

  private createNoopAlertDialogRef<T>(
    config: BraAlertDialogOptions<T>,
  ): BraAlertDialogRef<T> {
    const noopOverlayRef = {
      outsidePointerEvents: () => EMPTY,
      keydownEvents: () => EMPTY,
      dispose: () => undefined,
    } as unknown as OverlayRef;

    const noopContainer = {
      cancelTriggered: noopOutput,
      okTriggered: noopOutput,
      getNativeElement: () => null as unknown as HTMLElement,
    } as unknown as BraAlertDialogComponent<T>;

    return new BraAlertDialogRef<T>(noopOverlayRef, config, noopContainer);
  }

  private createOverlay(): OverlayRef | undefined {
    return createDialogOverlayRef({
      overlay: this.overlay,
      platformId: this.platformId,
      backdropClass: 'cdk-overlay-dark-backdrop',
    });
  }

  private disposeOverlayRef(overlayRef: OverlayRef): void {
    try {
      overlayRef.dispose();
    } catch {
      // Preserve the original attach/construction error.
    }
  }

  private attachAlertDialogContainer<T>(
    overlayRef: OverlayRef,
    config: BraAlertDialogOptions<T>,
  ): BraAlertDialogComponent<T> {
    return attachDialogContainerInstance({
      overlayRef,
      parentInjector: this.injector,
      optionsToken: BraAlertDialogOptions,
      options: config,
      containerComponent: BraAlertDialogComponent,
      viewContainerRef: config.zViewContainerRef,
    }) as BraAlertDialogComponent<T>;
  }

  private attachAlertDialogContent<T>(
    componentOrTemplateRef: BraDialogContentType<T>,
    alertDialogContainer: BraAlertDialogComponent<T>,
    overlayRef: OverlayRef,
    config: BraAlertDialogOptions<T>,
    releaseDocumentInert: () => void,
  ) {
    const alertDialogRef = new BraAlertDialogRef<T>(
      overlayRef,
      config,
      alertDialogContainer,
      releaseDocumentInert,
    );

    const componentInstance = attachDialogContent({
      componentOrTemplateRef,
      container: alertDialogContainer,
      viewContainerRef: config.zViewContainerRef,
      templateContext: {alertDialogRef} as T,
      createComponentInjector: () =>
        this.createInjector<T>(alertDialogRef, config),
    });

    if (componentInstance !== undefined) {
      alertDialogRef.componentInstance = componentInstance;
    }

    return alertDialogRef;
  }

  private createInjector<T>(
    alertDialogRef: BraAlertDialogRef<T>,
    config: BraAlertDialogOptions<T>,
  ) {
    return Injector.create({
      parent: this.injector,
      providers: [
        {provide: BraAlertDialogRef, useValue: alertDialogRef},
        {provide: Z_ALERT_MODAL_DATA, useValue: config.zData},
      ],
    });
  }
}
