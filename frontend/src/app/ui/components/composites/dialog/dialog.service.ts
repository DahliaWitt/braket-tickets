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
import {BraDialogRef} from './dialog-ref';
import {BraDialogComponent, BraDialogOptions} from './dialog.component';

export const BRA_MODAL_DATA = new InjectionToken<unknown>('BRA_MODAL_DATA');

const noopOutput = {
  subscribe: () => ({unsubscribe: () => undefined}),
};

@Injectable({
  providedIn: 'root',
})
export class BraDialogService {
  private readonly overlay = inject(Overlay);
  private readonly injector = inject(Injector);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly inertManager = inject(BraDialogDocumentInertManager);

  create<T, U>(config: BraDialogOptions<T, U>): BraDialogRef<T> {
    return this.open<T, U>(config.zContent, config);
  }

  private open<T, U>(
    componentOrTemplateRef: BraDialogContentType<T>,
    config: BraDialogOptions<T, U>,
  ) {
    const overlayRef = this.createOverlay();

    if (!overlayRef) {
      return this.createNoopDialogRef(config);
    }

    const releaseDocumentInert = this.inertManager.activate();

    try {
      const dialogContainer = this.attachDialogContainer<T, U>(
        overlayRef,
        config,
      );
      const dialogRef = this.attachDialogContent<T, U>(
        componentOrTemplateRef,
        dialogContainer,
        overlayRef,
        config,
        releaseDocumentInert,
      );

      dialogContainer.dialogRef = dialogRef;

      return dialogRef;
    } catch (error) {
      releaseDocumentInert();
      this.disposeOverlayRef(overlayRef);
      throw error;
    }
  }

  private createNoopDialogRef<T, U>(
    config: BraDialogOptions<T, U>,
  ): BraDialogRef<T> {
    const noopOverlayRef = {
      outsidePointerEvents: () => EMPTY,
      hasAttached: () => false,
      detachBackdrop: () => undefined,
      dispose: () => undefined,
    } as unknown as OverlayRef;

    const noopContainer = {
      cancelTriggered: noopOutput,
      okTriggered: noopOutput,
      getNativeElement: () =>
        ({classList: {add: () => undefined}}) as unknown as HTMLElement,
    } as unknown as BraDialogComponent<T, U>;

    return new BraDialogRef<T>(
      noopOverlayRef,
      config,
      noopContainer,
      this.platformId,
    );
  }

  private createOverlay(): OverlayRef | undefined {
    return createDialogOverlayRef({
      overlay: this.overlay,
      platformId: this.platformId,
    });
  }

  private disposeOverlayRef(overlayRef: OverlayRef): void {
    try {
      overlayRef.dispose();
    } catch {
      // Preserve the original attach/construction error.
    }
  }

  private attachDialogContainer<T, U>(
    overlayRef: OverlayRef,
    config: BraDialogOptions<T, U>,
  ): BraDialogComponent<T, U> {
    return attachDialogContainerInstance({
      overlayRef,
      parentInjector: this.injector,
      optionsToken: BraDialogOptions,
      options: config,
      containerComponent: BraDialogComponent,
      viewContainerRef: config.zViewContainerRef,
    }) as BraDialogComponent<T, U>;
  }

  private attachDialogContent<T, U>(
    componentOrTemplateRef: BraDialogContentType<T>,
    dialogContainer: BraDialogComponent<T, U>,
    overlayRef: OverlayRef,
    config: BraDialogOptions<T, U>,
    releaseDocumentInert: () => void,
  ) {
    const dialogRef = new BraDialogRef<T>(
      overlayRef,
      config,
      dialogContainer,
      this.platformId,
      releaseDocumentInert,
    );

    const componentInstance = attachDialogContent({
      componentOrTemplateRef,
      container: dialogContainer,
      viewContainerRef: config.zViewContainerRef,
      templateContext: {dialogRef} as T,
      createComponentInjector: () =>
        this.createInjector<T, U>(dialogRef, config),
    });

    if (componentInstance !== undefined) {
      dialogRef.componentInstance = componentInstance;
    }

    return dialogRef;
  }

  private createInjector<T, U>(
    dialogRef: BraDialogRef<T>,
    config: BraDialogOptions<T, U>,
  ) {
    return Injector.create({
      parent: this.injector,
      providers: [
        {provide: BraDialogRef, useValue: dialogRef},
        {provide: BRA_MODAL_DATA, useValue: config.zData},
      ],
    });
  }
}
