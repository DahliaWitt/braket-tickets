import type { OverlayRef } from '@angular/cdk/overlay';
import { afterNextRender, type Injector, runInInjectionContext } from '@angular/core';

import { type ZardSelectItemComponent } from './select-item.component';

interface DetermineOverlayWidthOnOpenArgs {
  injector: Injector;
  overlayRef: OverlayRef;
  portalWidth: number;
  selectItems: readonly ZardSelectItemComponent[];
  onReady: () => void;
}

export function determineOverlayWidthOnOpen(args: DetermineOverlayWidthOnOpenArgs): void {
  runInInjectionContext(args.injector, () => {
    afterNextRender(() => {
      if (!args.overlayRef.hasAttached()) {
        return;
      }

      const overlayPaneElement = args.overlayRef.overlayElement;
      const textElements = Array.from(
        overlayPaneElement.querySelectorAll<HTMLElement>(
          'z-select-item > span.truncate, [z-select-item] > span.truncate',
        ),
      );

      const isOverflow = textElements.some(
        (textElement) => textElement.scrollWidth > textElement.clientWidth + 1,
      );
      if (!isOverflow) {
        args.onReady();
        return;
      }

      let itemMaxWidth = 0;
      for (const item of args.selectItems) {
        itemMaxWidth = Math.max(itemMaxWidth, item.elementRef.nativeElement.scrollWidth);
      }

      const [selectItem] = args.selectItems;
      if (selectItem) {
        const elementStyles = getComputedStyle(selectItem.elementRef.nativeElement);
        const leftPadding = Number.parseFloat(elementStyles.getPropertyValue('padding-left')) || 0;
        const rightPadding =
          Number.parseFloat(elementStyles.getPropertyValue('padding-right')) || 0;
        itemMaxWidth += leftPadding + rightPadding;
      }

      itemMaxWidth = Math.max(itemMaxWidth, args.portalWidth);
      args.overlayRef.updateSize({ width: itemMaxWidth });
      args.overlayRef.updatePosition();
      args.onReady();
    });
  });
}
