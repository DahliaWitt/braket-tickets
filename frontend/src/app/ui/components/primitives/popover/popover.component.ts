import {
  type ConnectedPosition,
  Overlay,
  OverlayPositionBuilder,
  type OverlayRef,
} from '@angular/cdk/overlay';
import {TemplatePortal} from '@angular/cdk/portal';
import {isPlatformBrowser} from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  input,
  output,
  PLATFORM_ID,
  Renderer2,
  signal,
  type TemplateRef,
  ViewContainerRef,
} from '@angular/core';
import {takeUntilDestroyed, toObservable} from '@angular/core/rxjs-interop';

import {filter, type Subscription} from 'rxjs';

import {popoverVariants} from './popover.variants';

import {mergeClasses} from '@ui/utils/merge-classes';

export type ZardPopoverTrigger = 'click' | 'hover' | null;
export type ZardPopoverPlacement = 'top' | 'bottom' | 'left' | 'right';

const POPOVER_POSITIONS_MAP: Record<string, ConnectedPosition> = {
  top: {
    originX: 'center',
    originY: 'top',
    overlayX: 'center',
    overlayY: 'bottom',
    offsetX: 0,
    offsetY: -8,
  },
  bottom: {
    originX: 'center',
    originY: 'bottom',
    overlayX: 'center',
    overlayY: 'top',
    offsetX: 0,
    offsetY: 8,
  },
  left: {
    originX: 'start',
    originY: 'center',
    overlayX: 'end',
    overlayY: 'center',
    offsetX: -8,
    offsetY: 0,
  },
  right: {
    originX: 'end',
    originY: 'center',
    overlayX: 'start',
    overlayY: 'center',
    offsetX: 8,
    offsetY: 0,
  },
} as const;

@Directive({
  selector: '[zPopover]',
  exportAs: 'zPopover',
})
export class ZardPopoverDirective {
  private readonly destroyRef = inject(DestroyRef);
  private readonly overlay = inject(Overlay);
  private readonly overlayPositionBuilder = inject(OverlayPositionBuilder);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly viewContainerRef = inject(ViewContainerRef);
  private readonly platformId = inject(PLATFORM_ID);

  private overlayRef?: OverlayRef;
  private overlayRefSubscription?: Subscription;
  private listeners: (() => void)[] = [];
  private overlayListeners: (() => void)[] = [];

  private hoverDelayTimer: ReturnType<typeof setTimeout> | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;

  readonly zTrigger = input<ZardPopoverTrigger>('click');
  readonly zContent = input.required<TemplateRef<unknown>>();
  readonly zPlacement = input<ZardPopoverPlacement>('bottom');
  readonly zOrigin = input<ElementRef<HTMLElement>>();
  readonly zVisible = input<boolean>(false);
  readonly zOverlayClickable = input<boolean>(true);
  readonly zHoverDelay = input<number>(200);
  readonly zHoverGrace = input<number>(300);
  readonly zVisibleChange = output<boolean>();

  private readonly isVisible = signal(false);

  get nativeElement() {
    return this.zOrigin()?.nativeElement ?? this.elementRef.nativeElement;
  }

  constructor() {
    toObservable(this.zVisible)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((visible) => {
        const currentlyVisible = this.isVisible();
        if (visible && !currentlyVisible) {
          this.show();
        } else if (!visible && currentlyVisible) {
          this.hide();
        }
      });

    toObservable(this.zTrigger)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.listeners.length) {
          this.unlistenAll();
        }
        this.setupTriggers();
        // Re-establish outside-click dismissal for the current trigger.
        // This is a no-op until the overlay exists — createOverlay() calls
        // subscribeToOverlayRef() once the overlayRef has been created.
        this.subscribeToOverlayRef();
      });

    afterNextRender(() => {
      this.createOverlay();
    });

    this.destroyRef.onDestroy(() => {
      this.clearHoverDelayTimer();
      this.clearGraceTimer();
      this.unlistenAll();
      this.unlistenOverlay();
      this.overlayRefSubscription?.unsubscribe();
      this.overlayRef?.dispose();
    });
  }

  show() {
    if (this.isVisible()) {
      return;
    }

    if (!this.overlayRef) {
      this.createOverlay();
    }

    const templatePortal = new TemplatePortal(
      this.zContent(),
      this.viewContainerRef,
    );
    this.overlayRef?.attach(templatePortal);
    this.isVisible.set(true);
    this.zVisibleChange.emit(true);

    if (this.zTrigger() === 'hover' && this.overlayRef) {
      this.unlistenOverlay();
      const el = this.overlayRef.overlayElement;
      this.overlayListeners.push(
        this.renderer.listen(el, 'mouseenter', () => this.clearGraceTimer()),
      );
      this.overlayListeners.push(
        this.renderer.listen(el, 'mouseleave', () => {
          this.clearGraceTimer();
          this.graceTimer = setTimeout(() => this.hide(), this.zHoverGrace());
        }),
      );
    }
  }

  hide() {
    if (!this.isVisible()) {
      return;
    }

    this.unlistenOverlay();
    this.overlayRef?.detach();
    this.isVisible.set(false);
    this.zVisibleChange.emit(false);
  }

  toggle() {
    if (this.isVisible()) {
      this.hide();
    } else {
      this.show();
    }
  }

  private createOverlay() {
    if (isPlatformBrowser(this.platformId)) {
      // Guard against duplicate creation: afterNextRender and a lazy show()
      // can both reach here. A second overlay would orphan the first (and its
      // attached portal) and stack outside-click subscriptions.
      if (this.overlayRef) {
        return;
      }

      const positionStrategy = this.overlayPositionBuilder
        .flexibleConnectedTo(this.nativeElement)
        .withPositions(this.getPositions())
        .withPush(false)
        .withFlexibleDimensions(false)
        .withViewportMargin(8);

      this.overlayRef = this.overlay.create({
        positionStrategy,
        hasBackdrop: false,
        scrollStrategy: this.overlay.scrollStrategies.reposition(),
      });

      // The overlay ref now exists, so the outside-click subscription can
      // finally attach. subscribeToOverlayRef() was a no-op during the first
      // change-detection pass (before the overlay was created).
      this.subscribeToOverlayRef();
    }
  }

  private subscribeToOverlayRef(): void {
    // Always tear down any existing subscription first so trigger changes and
    // repeated createOverlay/subscribe calls never stack duplicate listeners.
    this.overlayRefSubscription?.unsubscribe();
    this.overlayRefSubscription = undefined;

    if (
      this.zTrigger() === 'click' &&
      isPlatformBrowser(this.platformId) &&
      this.overlayRef
    ) {
      this.overlayRefSubscription = this.overlayRef
        .outsidePointerEvents()
        .pipe(
          // Evaluate zOverlayClickable() per-event so consumers can toggle
          // outside-click dismissal at runtime, not just at subscribe time.
          filter(() => this.zOverlayClickable()),
          filter((event) => {
            const target = event.target;
            if (!(target instanceof Node)) return true;
            return !this.nativeElement.contains(target);
          }),
        )
        .subscribe(() => this.hide());
    }
  }

  private setupTriggers() {
    const trigger = this.zTrigger();
    if (!trigger) {
      return;
    }

    // Add Escape key handler for all triggers
    this.listeners.push(
      this.renderer.listen(
        this.nativeElement,
        'keydown',
        (event: KeyboardEvent) => {
          if (event.key === 'Escape' && this.isVisible()) {
            event.preventDefault();
            this.hide();
          }
        },
      ),
    );

    if (trigger === 'click') {
      this.listeners.push(
        this.renderer.listen(this.nativeElement, 'click', (event: Event) => {
          event.stopPropagation();
          this.toggle();
        }),
      );
      // Add Enter/Space for keyboard activation
      this.listeners.push(
        this.renderer.listen(
          this.nativeElement,
          'keydown',
          (event: KeyboardEvent) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              this.toggle();
            }
          },
        ),
      );
    } else if (trigger === 'hover') {
      // Use maxTouchPoints as the canonical touch check — it's defined in the W3C Pointer Events
      // spec and reliable across browsers. Avoid 'ontouchstart' in window which is true in
      // jsdom (test environment) and some non-touch browsers.
      const isTouch = navigator.maxTouchPoints > 0;

      if (isTouch) {
        // Touch devices: tap to toggle, tap outside to close
        this.listeners.push(
          this.renderer.listen(
            this.nativeElement,
            'touchstart',
            (event: TouchEvent) => {
              event.stopPropagation();
              this.toggle();
            },
          ),
        );

        const outsideTouchHandler = (event: TouchEvent) => {
          const target = event.target;
          if (
            this.isVisible() &&
            (!(target instanceof Node) || !this.nativeElement.contains(target))
          ) {
            this.hide();
          }
        };
        this.listeners.push(
          this.renderer.listen('document', 'touchstart', outsideTouchHandler),
        );
      } else {
        this.listeners.push(
          this.renderer.listen(this.nativeElement, 'mouseenter', () => {
            this.clearGraceTimer();
            this.hoverDelayTimer = setTimeout(
              () => this.show(),
              this.zHoverDelay(),
            );
          }),
        );

        this.listeners.push(
          this.renderer.listen(this.nativeElement, 'mouseleave', () => {
            this.clearHoverDelayTimer();
            this.clearGraceTimer();
            this.graceTimer = setTimeout(() => this.hide(), this.zHoverGrace());
          }),
        );
      }

      // Add focus/blur for keyboard users (equivalent to hover)
      this.listeners.push(
        this.renderer.listen(this.nativeElement, 'focus', () => {
          this.clearGraceTimer();
          this.show();
        }),
      );

      this.listeners.push(
        this.renderer.listen(this.nativeElement, 'blur', () => this.hide()),
      );
    }
  }

  private unlistenAll(): void {
    for (const listener of this.listeners) {
      listener();
    }
    this.listeners = [];
  }

  private unlistenOverlay(): void {
    for (const listener of this.overlayListeners) {
      listener();
    }
    this.overlayListeners = [];
  }

  private clearHoverDelayTimer(): void {
    if (this.hoverDelayTimer !== null) {
      clearTimeout(this.hoverDelayTimer);
      this.hoverDelayTimer = null;
    }
  }

  private clearGraceTimer(): void {
    if (this.graceTimer !== null) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }

  private getPositions(): ConnectedPosition[] {
    const placement = this.zPlacement();
    const positions: ConnectedPosition[] = [];

    // Primary position
    const primaryConfig = POPOVER_POSITIONS_MAP[placement];
    positions.push({
      originX: primaryConfig.originX,
      originY: primaryConfig.originY,
      overlayX: primaryConfig.overlayX,
      overlayY: primaryConfig.overlayY,
      offsetX: primaryConfig.offsetX ?? 0,
      offsetY: primaryConfig.offsetY ?? 0,
    });

    // Fallback positions for better positioning when primary doesn't fit
    switch (placement) {
      case 'bottom':
        // Try top if bottom doesn't fit
        positions.push({
          originX: 'center',
          originY: 'top',
          overlayX: 'center',
          overlayY: 'bottom',
          offsetX: 0,
          offsetY: -8,
        });
        // If neither top nor bottom work, try right
        positions.push({
          originX: 'end',
          originY: 'center',
          overlayX: 'start',
          overlayY: 'center',
          offsetX: 8,
          offsetY: 0,
        });
        // Finally try left
        positions.push({
          originX: 'start',
          originY: 'center',
          overlayX: 'end',
          overlayY: 'center',
          offsetX: -8,
          offsetY: 0,
        });
        break;
      case 'top':
        // Try bottom if top doesn't fit
        positions.push({
          originX: 'center',
          originY: 'bottom',
          overlayX: 'center',
          overlayY: 'top',
          offsetX: 0,
          offsetY: 8,
        });
        // If neither top nor bottom work, try right
        positions.push({
          originX: 'end',
          originY: 'center',
          overlayX: 'start',
          overlayY: 'center',
          offsetX: 8,
          offsetY: 0,
        });
        // Finally try left
        positions.push({
          originX: 'start',
          originY: 'center',
          overlayX: 'end',
          overlayY: 'center',
          offsetX: -8,
          offsetY: 0,
        });
        break;
      case 'right':
        // Try left if right doesn't fit
        positions.push({
          originX: 'start',
          originY: 'center',
          overlayX: 'end',
          overlayY: 'center',
          offsetX: -8,
          offsetY: 0,
        });
        // If neither left nor right work, try bottom
        positions.push({
          originX: 'center',
          originY: 'bottom',
          overlayX: 'center',
          overlayY: 'top',
          offsetX: 0,
          offsetY: 8,
        });
        // Finally try top
        positions.push({
          originX: 'center',
          originY: 'top',
          overlayX: 'center',
          overlayY: 'bottom',
          offsetX: 0,
          offsetY: -8,
        });
        break;
      case 'left':
        // Try right if left doesn't fit
        positions.push({
          originX: 'end',
          originY: 'center',
          overlayX: 'start',
          overlayY: 'center',
          offsetX: 8,
          offsetY: 0,
        });
        // If neither left nor right work, try bottom
        positions.push({
          originX: 'center',
          originY: 'bottom',
          overlayX: 'center',
          overlayY: 'top',
          offsetX: 0,
          offsetY: 8,
        });
        // Finally try top
        positions.push({
          originX: 'center',
          originY: 'top',
          overlayX: 'center',
          overlayY: 'bottom',
          offsetX: 0,
          offsetY: -8,
        });
        break;
    }

    return positions;
  }
}

@Component({
  selector: 'z-popover',
  imports: [],
  template: ` <ng-content /> `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'classes()',
  },
})
export class ZardPopoverComponent {
  readonly class = input<string>('');

  protected readonly classes = computed(() =>
    mergeClasses(popoverVariants(), this.class()),
  );
}
