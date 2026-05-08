import { isPlatformBrowser } from '@angular/common';
import { OverlayConfig, type ComponentType, type Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal, TemplatePortal } from '@angular/cdk/portal';
import {
  type ComponentRef,
  type EmbeddedViewRef,
  Injector,
  type ProviderToken,
  TemplateRef,
  type ViewContainerRef,
} from '@angular/core';

export type BraDialogContentType<T> = ComponentType<T> | TemplateRef<T> | string | undefined;

interface PortalHost {
  attachComponentPortal: <C>(portal: ComponentPortal<C>) => ComponentRef<C>;
  attachTemplatePortal: <C>(portal: TemplatePortal<C>) => EmbeddedViewRef<C>;
}

interface CreateDialogOverlayParams {
  overlay: Overlay;
  platformId: object;
  backdropClass?: string;
}

export function createDialogOverlayRef({
  overlay,
  platformId,
  backdropClass,
}: CreateDialogOverlayParams): OverlayRef | undefined {
  if (!isPlatformBrowser(platformId)) {
    return undefined;
  }

  return overlay.create(
    new OverlayConfig({
      hasBackdrop: true,
      backdropClass,
      positionStrategy: overlay.position().global(),
    }),
  );
}

interface AttachDialogContainerParams<TContainer> {
  overlayRef: OverlayRef;
  parentInjector: Injector;
  optionsToken: ProviderToken<unknown>;
  options: unknown;
  containerComponent: ComponentType<TContainer>;
  viewContainerRef?: ViewContainerRef;
}

export function attachDialogContainerInstance<TContainer>({
  overlayRef,
  parentInjector,
  optionsToken,
  options,
  containerComponent,
  viewContainerRef,
}: AttachDialogContainerParams<TContainer>): TContainer {
  const injector = Injector.create({
    parent: parentInjector,
    providers: [
      { provide: OverlayRef, useValue: overlayRef },
      { provide: optionsToken, useValue: options },
    ],
  });

  const containerPortal = new ComponentPortal(containerComponent, viewContainerRef, injector);
  const containerRef = overlayRef.attach(containerPortal);

  return containerRef.instance;
}

interface AttachDialogContentParams<T, TContext> {
  componentOrTemplateRef: BraDialogContentType<T>;
  container: PortalHost;
  viewContainerRef?: ViewContainerRef;
  templateContext: TContext;
  createComponentInjector: () => Injector;
}

export function attachDialogContent<T, TContext>({
  componentOrTemplateRef,
  container,
  viewContainerRef,
  templateContext,
  createComponentInjector,
}: AttachDialogContentParams<T, TContext>): T | undefined {
  if (componentOrTemplateRef instanceof TemplateRef) {
    container.attachTemplatePortal(
      new TemplatePortal<T>(
        componentOrTemplateRef,
        null as unknown as ViewContainerRef,
        templateContext as unknown as T,
      ),
    );
    return undefined;
  }

  if (!componentOrTemplateRef || typeof componentOrTemplateRef === 'string') {
    return undefined;
  }

  const contentRef = container.attachComponentPortal(
    new ComponentPortal(componentOrTemplateRef, viewContainerRef, createComponentInjector()),
  );
  return contentRef.instance;
}
