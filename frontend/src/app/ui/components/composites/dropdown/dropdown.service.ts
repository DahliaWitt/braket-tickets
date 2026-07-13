import {
  Overlay,
  OverlayPositionBuilder,
  type OverlayRef,
} from '@angular/cdk/overlay';
import {TemplatePortal} from '@angular/cdk/portal';
import {isPlatformBrowser} from '@angular/common';
import {
  computed,
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

import {filter, type Subscription} from 'rxjs';

import {noopFn} from '@ui/utils/noop';
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

  /** Tears down the overlay-panel hover keep-alive listeners for the open menu. */
  private unlistenOverlayHover: () => void = noopFn;
  /** Pending grace-period close timer for hover mode; null when none is scheduled. */
  private hoverGraceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Grace period (ms) applied to the currently open hover menu. */
  private hoverGraceMs = 0;

  readonly activeTrigger = signal<HTMLElement | null>(null);
  readonly isOpen = computed(() => this.activeTrigger() !== null);

  constructor() {
    this.renderer = this.rendererFactory.createRenderer(null, null);
  }

  toggle(
    triggerElement: ElementRef<HTMLElement>,
    template: TemplateRef<unknown>,
    viewContainerRef: ViewContainerRef,
    menuId: string,
    triggerId: string,
  ) {
    if (this.activeTrigger() === triggerElement.nativeElement) {
      this.close();
    } else {
      this.open(triggerElement, template, viewContainerRef, menuId, triggerId);
    }
  }

  /**
   * Open (or keep open) a menu for hover interaction. Cancels any pending
   * grace-period close so moving the pointer from the trigger into the menu
   * does not dismiss it. Idempotent when the menu is already open for this
   * trigger.
   */
  openHover(
    triggerElement: ElementRef<HTMLElement>,
    template: TemplateRef<unknown>,
    viewContainerRef: ViewContainerRef,
    menuId: string,
    triggerId: string,
    graceMs: number,
  ) {
    this.clearHoverGraceTimer();
    this.hoverGraceMs = graceMs;

    if (this.activeTrigger() === triggerElement.nativeElement) {
      return;
    }

    this.open(triggerElement, template, viewContainerRef, menuId, triggerId, {
      hover: true,
    });
  }

  /**
   * Schedule a grace-period close for the active hover menu, giving the pointer
   * time to travel across the gap between the trigger and the menu. A no-op
   * when nothing is open.
   */
  scheduleHoverClose() {
    if (!this.isOpen()) {
      return;
    }

    this.clearHoverGraceTimer();
    const activeTriggerAtSchedule = this.activeTrigger();
    this.hoverGraceTimer = setTimeout(() => {
      this.hoverGraceTimer = null;
      // Only close if the same menu is still open (the pointer never returned).
      if (this.activeTrigger() === activeTriggerAtSchedule) {
        this.close();
      }
    }, this.hoverGraceMs);
  }

  /** Cancel a pending grace-period close (e.g. the pointer re-entered). */
  cancelHoverClose() {
    this.clearHoverGraceTimer();
  }

  private open(
    triggerElement: ElementRef<HTMLElement>,
    template: TemplateRef<unknown>,
    viewContainerRef: ViewContainerRef,
    menuId: string,
    triggerId: string,
    options: {hover?: boolean} = {},
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

    if (options.hover) {
      this.setupHoverKeepAlive();
    }

    setTimeout(() => {
      this.setupKeyboardNavigation();
      this.focusInitialItem();
      this.applyMenuAria(menuId, triggerId);
    }, 0);

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
    this.activeTrigger.set(triggerElement.nativeElement);
  }

  close() {
    this.clearHoverGraceTimer();
    this.unlistenOverlayHover();
    this.unlistenOverlayHover = noopFn;
    if (this.overlayRef?.hasAttached()) {
      this.overlayRef.detach();
    }
    this.focusedIndex.set(-1);
    this.unlisten();
    this.destroyOverlay();
    this.activeTrigger.set(null);
  }

  /**
   * Treat the overlay panel as part of the hover region: entering it cancels a
   * pending close, and leaving it schedules one. This bridges the pixel gap
   * between the trigger and the menu so hover mode stays usable.
   */
  private setupHoverKeepAlive() {
    if (
      !this.overlayRef?.hasAttached() ||
      !isPlatformBrowser(this.platformId)
    ) {
      return;
    }

    const panel = this.overlayRef.overlayElement;
    const enter = this.renderer.listen(panel, 'mouseenter', () =>
      this.cancelHoverClose(),
    );
    const leave = this.renderer.listen(panel, 'mouseleave', () =>
      this.scheduleHoverClose(),
    );
    this.unlistenOverlayHover = () => {
      enter();
      leave();
    };
  }

  private clearHoverGraceTimer() {
    if (this.hoverGraceTimer !== null) {
      clearTimeout(this.hoverGraceTimer);
      this.hoverGraceTimer = null;
    }
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
    if (
      !this.overlayRef?.hasAttached() ||
      !isPlatformBrowser(this.platformId)
    ) {
      return;
    }

    const dropdownElement = this.overlayRef.overlayElement.querySelector(
      '[role="menu"]',
    ) as HTMLElement;
    if (!dropdownElement) {
      return;
    }

    this.unlisten = this.renderer.listen(
      dropdownElement,
      'keydown',
      (event: KeyboardEvent) => {
        const key = event.key as KeyboardNavKey;
        if (NAVIGATION_KEYS.includes(key)) {
          event.preventDefault();
          const items = this.getDropdownItems();

          switch (key) {
            case 'ArrowDown':
              navigateItems(1, items, this.focusedIndex(), (idx) =>
                this.updateFocusedItem(items, idx),
              );
              break;
            case 'ArrowUp':
              navigateItems(-1, items, this.focusedIndex(), (idx) =>
                this.updateFocusedItem(items, idx),
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
              focusItemAtIndex(items, items.length - 1, (idx) =>
                this.focusedIndex.set(idx),
              );
              break;
          }
        }
      },
    );

    // Focus dropdown container
    dropdownElement.focus();
  }

  private getDropdownItems(): HTMLElement[] {
    if (!this.overlayRef?.hasAttached()) {
      return [];
    }
    const dropdownElement = this.overlayRef.overlayElement;
    return Array.from(
      dropdownElement.querySelectorAll<HTMLElement>(
        'bra-dropdown-menu-item, [bra-dropdown-menu-item]',
      ),
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

  private applyMenuAria(menuId: string, triggerId: string): void {
    const menuElement =
      this.overlayRef?.overlayElement.querySelector('[role="menu"]');
    if (!menuElement) return;
    menuElement.id = menuId;
    menuElement.setAttribute('aria-labelledby', triggerId);
  }
}
