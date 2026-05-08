import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  signal,
  ViewEncapsulation,
  booleanAttribute,
} from '@angular/core';

import type {ClassValue} from 'clsx';

import {
  buttonVariants,
  type ZardButtonShapeVariants,
  type ZardButtonSizeVariants,
  type ZardButtonTypeVariants,
} from './button.variants';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';

import {mergeClasses} from '@ui/utils/merge-classes';

@Component({
  selector: 'z-button, button[z-button], a[z-button]',
  imports: [ZardIconComponent],
  template: `
    @if (zLoading()) {
      <z-icon
        zType="loader-circle"
        class="animate-spin duration-2000"
        aria-hidden="true"
      />
    }
    <ng-content />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'classes()',
    '[attr.aria-busy]': 'zLoading()',
    '[attr.data-type]': 'zType()',
    '[attr.data-glow]': 'zGlow() || null',
    '[attr.data-icon-only]': 'iconOnly() || null',
    '[attr.data-disabled]': 'resolvedDisabled() ? "" : null',
    '[attr.aria-disabled]': 'ariaDisabledAttr()',
    '[attr.disabled]': 'hostDisabledAttr()',
    '[attr.role]': 'usesSyntheticButtonBehavior() ? "button" : null',
    '[attr.tabindex]': 'tabIndexAttr()',
    '(keydown)': 'onKeydown($event)',
  },
  exportAs: 'zButton',
})
export class ZardButtonComponent {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly initiallyNativeDisabled =
    this.elementRef.nativeElement.hasAttribute('disabled');

  readonly zType = input<ZardButtonTypeVariants>('default');
  readonly zSize = input<ZardButtonSizeVariants>('default');
  readonly zShape = input<ZardButtonShapeVariants>('default');
  readonly class = input<ClassValue>('');
  readonly zFull = input(false, {transform: booleanAttribute});
  readonly zLoading = input(false, {transform: booleanAttribute});
  readonly zDisabled = input(false, {transform: booleanAttribute});
  readonly zGlow = input(false, {transform: booleanAttribute});

  protected readonly effectivelyDisabled = computed(
    () => this.zDisabled() || this.zLoading(),
  );

  private readonly iconOnlyState = signal(false);
  readonly iconOnly = this.iconOnlyState.asReadonly();

  private _mutationObserver: MutationObserver | null = null;
  private readonly preventDisabledAnchorClick = (event: MouseEvent) => {
    if (this.isNativeAnchor() && this.resolvedDisabled()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  constructor() {
    afterNextRender(() => {
      const check = () => {
        const el = this.elementRef.nativeElement;
        const hasIcon = el.querySelector('z-icon, [z-icon]') !== null;
        const children = Array.from<Node>(el.childNodes);
        const hasText = children.some((node) => {
          if (node.nodeType === 3) {
            return node.textContent?.trim() !== '';
          }
          if (node.nodeType === 1) {
            const element = node as HTMLElement;
            if (element.matches('z-icon, [z-icon]')) {
              return false;
            }
            return element.textContent?.trim() !== '';
          }
          return false;
        });

        this.iconOnlyState.set(hasIcon && !hasText);
      };

      check();
      this._mutationObserver = new MutationObserver(check);
      this._mutationObserver.observe(this.elementRef.nativeElement, {
        childList: true,
        characterData: true,
        subtree: true,
      });

      this.elementRef.nativeElement.addEventListener(
        'click',
        this.preventDisabledAnchorClick,
        {
          capture: true,
        },
      );
    });

    this.destroyRef.onDestroy(() => {
      if (this._mutationObserver) {
        this._mutationObserver.disconnect();
        this._mutationObserver = null;
      }
      this.elementRef.nativeElement.removeEventListener(
        'click',
        this.preventDisabledAnchorClick,
        {
          capture: true,
        },
      );
    });
  }

  protected readonly classes = computed(() =>
    mergeClasses(
      buttonVariants({
        zType: this.zType(),
        zSize: this.zSize(),
        zShape: this.zShape(),
        zFull: this.zFull(),
        zLoading: this.zLoading(),
        zDisabled: this.resolvedDisabled(),
        zGlow: this.zGlow(),
      }),
      this.class(),
    ),
  );

  protected readonly usesSyntheticButtonBehavior = computed(() => {
    // Evaluated once; assumes component parent doesn't change after mount.
    // Native buttons and links already provide keyboard and semantic behavior.
    const zardButtonElement = this.elementRef.nativeElement;
    if (this.isNativeButton() || this.isNativeAnchor()) {
      return false;
    }
    if (zardButtonElement.parentElement) {
      const {tagName} = zardButtonElement.parentElement;
      return tagName !== 'BUTTON' && tagName !== 'A';
    }
    return true;
  });

  private readonly isNativeButton = computed(
    () => this.elementRef.nativeElement.tagName === 'BUTTON',
  );
  private readonly isNativeAnchor = computed(
    () => this.elementRef.nativeElement.tagName === 'A',
  );

  protected resolvedDisabled(): boolean {
    return this.effectivelyDisabled() || this.hasNativeDisabledAttribute();
  }

  protected ariaDisabledAttr(): 'true' | null {
    return (this.usesSyntheticButtonBehavior() || this.isNativeAnchor()) &&
      this.resolvedDisabled()
      ? 'true'
      : null;
  }

  protected hostDisabledAttr(): '' | null {
    if (this.isNativeAnchor()) {
      return null;
    }
    if (this.isNativeButton() || this.usesSyntheticButtonBehavior()) {
      return this.resolvedDisabled() ? '' : null;
    }
    return this.hasNativeDisabledAttribute() ? '' : null;
  }

  protected tabIndexAttr(): '0' | '-1' | null {
    if (
      this.resolvedDisabled() &&
      (this.usesSyntheticButtonBehavior() || this.isNativeAnchor())
    ) {
      return '-1';
    }
    return this.usesSyntheticButtonBehavior() ? '0' : null;
  }

  private hasNativeDisabledAttribute(): boolean {
    return this.initiallyNativeDisabled;
  }

  protected onKeydown(event: KeyboardEvent) {
    if (this.usesSyntheticButtonBehavior() && !this.resolvedDisabled()) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (event.repeat) return;
        this.elementRef.nativeElement.click();
      }
    }
  }
}
