import { Overlay, OverlayPositionBuilder, type OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { isPlatformBrowser } from '@angular/common';
import {
  type ElementRef,
  inject,
  Injectable,
  PLATFORM_ID,
  type Renderer2,
  RendererFactory2,
  signal,
  type TemplateRef,
  type ViewContainerRef,
} from '@angular/core';

import { filter, type Subscription } from 'rxjs';

import { noopFn } from '@ui/utils/noop';
import {
  navigateItems,
  focusItemAtIndex,
  focusInitialItem,
  selectFocusedItem,
  updateItemFocus,
  NAVIGATION_KEYS,
  type KeyboardNavKey,
} from '@ui/utils/keyboard-navigation';

@Injectable({
  providedIn: 'root',
})
export class BraDropdownService {
  private readonly overlay = inject(Overlay);
  private readonly overlayPositionBuilder = inject(OverlayPositionBuilder);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly rendererFactory = inject(RendererFactory2);

  private overlayRef?: OverlayRef;
  private portal?: TemplatePortal;
  private triggerElement?: ElementRef<HTMLElement>;
  private renderer!: Renderer2;
  private readonly focusedIndex = signal<number>(-1);
  private outsideClickSubscription!: Subscription;
  private unlisten: () => void = noopFn;

  readonly isOpen = signal(false);

  constructor() {
    this.renderer = this.rendererFactory.createRenderer(null, null);
  }

  toggle(
    triggerElement: ElementRef<HTMLElement>,
    template: TemplateRef<unknown>,
    viewContainerRef: ViewContainerRef,
  ) {
    if (this.isOpen()) {
      this.close();
    } else {
      this.open(triggerElement, template, viewContainerRef);
    }
  }

  private open(
    triggerElement: ElementRef<HTMLElement>,
    template: TemplateRef<unknown>,
    viewContainerRef: ViewContainerRef,
  ) {
    if (this.isOpen()) {
      this.close();
    }

    this.triggerElement = triggerElement;
    this.createOverlay(triggerElement);

    if (!this.overlayRef) {
      return;
    }

    this.portal = new TemplatePortal(template, viewContainerRef);
    this.overlayRef.attach(this.portal);

    // Setup keyboard navigation
    setTimeout(() => {
      this.setupKeyboardNavigation();
      this.focusInitialItem();
    }, 0);

    // Close on outside click
    this.outsideClickSubscription = this.overlayRef
      .outsidePointerEvents()
      .pipe(
        filter((event) => {
          const target = event.target;
          if (!(target instanceof Node)) return true;
          return !triggerElement.nativeElement.contains(target);
        }),
      )
      .subscribe(() => {
        this.close();
      });
    this.isOpen.set(true);
  }

  close() {
    if (this.overlayRef?.hasAttached()) {
      this.overlayRef.detach();
    }
    this.focusedIndex.set(-1);
    this.unlisten();
    this.destroyOverlay();
    this.isOpen.set(false);
  }

  private createOverlay(triggerElement: ElementRef<HTMLElement>) {
    if (this.overlayRef) {
      this.destroyOverlay();
    }

    const positionStrategy = this.overlayPositionBuilder
      .flexibleConnectedTo(triggerElement)
      .withPositions([
        // Primary: align left edge of dropdown to left edge of trigger
        {
          originX: 'start',
          originY: 'bottom',
          overlayX: 'start',
          overlayY: 'top',
          offsetY: 4,
        },
        // Fallback: align right edge of dropdown to right edge of trigger (for triggers near right edge)
        {
          originX: 'end',
          originY: 'bottom',
          overlayX: 'end',
          overlayY: 'top',
          offsetY: 4,
        },
        // Fallback: open above trigger, left-aligned
        {
          originX: 'start',
          originY: 'top',
          overlayX: 'start',
          overlayY: 'bottom',
          offsetY: -4,
        },
        // Fallback: open above trigger, right-aligned
        {
          originX: 'end',
          originY: 'top',
          overlayX: 'end',
          overlayY: 'bottom',
          offsetY: -4,
        },
      ])
      .withPush(true);

    this.overlayRef = this.overlay.create({
      positionStrategy,
      hasBackdrop: false,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      minWidth: 200,
      maxHeight: 400,
    });
  }

  private destroyOverlay() {
    this.overlayRef?.dispose();
    this.overlayRef = undefined;
    this.outsideClickSubscription?.unsubscribe();
  }

  private setupKeyboardNavigation() {
    if (!this.overlayRef?.hasAttached() || !isPlatformBrowser(this.platformId)) {
      return;
    }

    const dropdownElement = this.overlayRef.overlayElement.querySelector(
      '[role="menu"]',
    ) as HTMLElement;
    if (!dropdownElement) {
      return;
    }

    this.unlisten = this.renderer.listen(dropdownElement, 'keydown', (event: KeyboardEvent) => {
      const key = event.key as KeyboardNavKey;
      if (NAVIGATION_KEYS.includes(key)) {
        event.preventDefault();
        const items = this.getDropdownItems();

        switch (key) {
          case 'ArrowDown':
            navigateItems(
              1,
              items,
              this.focusedIndex(),
              (idx) => this.updateFocusedItem(items, idx),
            );
            break;
          case 'ArrowUp':
            navigateItems(
              -1,
              items,
              this.focusedIndex(),
              (idx) => this.updateFocusedItem(items, idx),
            );
            break;
          case 'Enter':
          case ' ':
            this.selectFocusedItem(items);
            break;
          case 'Escape':
            this.close();
            this.triggerElement?.nativeElement.focus();
            break;
          case 'Home':
            focusItemAtIndex(items, 0, (idx) => this.focusedIndex.set(idx));
            break;
          case 'End':
            focusItemAtIndex(items, items.length - 1, (idx) => this.focusedIndex.set(idx));
            break;
        }
      }
    });

    // Focus dropdown container
    dropdownElement.focus();
  }

  private getDropdownItems(): HTMLElement[] {
    if (!this.overlayRef?.hasAttached()) {
      return [];
    }
    const dropdownElement = this.overlayRef.overlayElement;
    return Array.from(
      dropdownElement.querySelectorAll<HTMLElement>('bra-dropdown-menu-item, [bra-dropdown-menu-item]'),
    ).filter((item) => item.dataset['disabled'] === undefined);
  }

  private focusInitialItem() {
    const items = this.getDropdownItems();
    focusInitialItem(items, (idx) => this.focusedIndex.set(idx));
  }

  private selectFocusedItem(items: HTMLElement[]) {
    const item = selectFocusedItem(items, this.focusedIndex());
    item?.click();
  }

  private updateFocusedItem(items: HTMLElement[], index: number): void {
    this.focusedIndex.set(index);
    updateItemFocus(items, index);
  }
}
