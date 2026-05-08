import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  ViewEncapsulation,
  inject,
  afterNextRender,
  DestroyRef,
  PLATFORM_ID,
} from '@angular/core';
import {DOCUMENT, isPlatformBrowser} from '@angular/common';

import type {ClassValue} from 'clsx';
import {NgxSonnerToaster, toast} from 'ngx-sonner';

import {toastVariants, type BraToastVariants} from './toast.variants';

import {mergeClasses} from '@ui/utils/merge-classes';

@Component({
  selector: 'bra-toast, bra-toaster',
  imports: [NgxSonnerToaster],
  template: `
    @if (isBrowser) {
      <ngx-sonner-toaster
        [theme]="theme()"
        [class]="classes()"
        [position]="position()"
        [richColors]="richColors()"
        [expand]="expand()"
        [duration]="duration()"
        [visibleToasts]="visibleToasts()"
        [closeButton]="closeButton()"
        [toastOptions]="toastOptions()"
        [dir]="dir()"
      />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  exportAs: 'zToast',
})
export class BraToastComponent {
  readonly class = input<ClassValue>('');
  readonly variant = input<BraToastVariants['variant']>('default');
  readonly theme = input<'light' | 'dark' | 'system'>('system');
  readonly position = input<
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right'
  >('bottom-right');

  readonly richColors = input<boolean>(true);
  readonly expand = input<boolean>(false);
  readonly duration = input<number>(4000);
  readonly visibleToasts = input<number>(3);
  readonly closeButton = input<boolean>(false);
  readonly toastOptions = input<Record<string, unknown>>({});
  readonly dir = input<'ltr' | 'rtl' | 'auto'>('auto');

  private readonly doc = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  // Bound keydown handler for cleanup
  private handleKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      toast.dismiss();
    }
    if (e.altKey && e.key === 't') {
      // There isn't a direct expand API in ngx-sonner yet exposed cleanly,
      // but usually the hover triggers it.
      // For now, we'll just focus on dismiss as the primary action.
      // Keeping the listener stub incase we find a way to toggle expand programmatically later.
    }
  };

  constructor() {
    afterNextRender(() => {
      if (!this.isBrowser) {
        return;
      }

      // Keyboard shortcuts for power users
      // Esc: Close all toasts
      // Alt + T: Expand toasts
      this.doc.addEventListener('keydown', this.handleKeydown);
    });

    // Cleanup event listener on destroy
    this.destroyRef.onDestroy(() => {
      this.doc.removeEventListener('keydown', this.handleKeydown);
    });
  }

  protected readonly classes = computed(() =>
    mergeClasses(
      'toaster group',
      toastVariants({variant: this.variant()}),
      this.class(),
    ),
  );
}
