import {
  type AfterViewInit,
  computed,
  Directive,
  effect,
  ElementRef,
  inject,
  input,
  linkedSignal,
  model,
  type OnDestroy,
} from '@angular/core';

import type {ClassValue} from 'clsx';

import {readInputValue} from '@ui/utils/dom-event';
import {
  inputVariants,
  type ZardInputSizeVariants,
  type ZardInputStatusVariants,
  type ZardInputTypeVariants,
} from './input.variants';

import {mergeClasses, transform} from '@ui/utils/merge-classes';

@Directive({
  selector: 'input[zInput], textarea[zInput]',
  host: {
    '[class]': 'classes()',
    '(input)': 'updateValue($event.target)',
    '[attr.aria-invalid]': 'isInvalid()',
    '[attr.aria-describedby]': 'describedBy()',
  },
  exportAs: 'zInput',
})
export class ZardInputDirective implements AfterViewInit, OnDestroy {
  private readonly elementRef =
    inject<ElementRef<HTMLInputElement | HTMLTextAreaElement>>(ElementRef);
  private passwordPlaceholderObserver?: MutationObserver;

  readonly class = input<ClassValue>('');
  readonly zBorderless = input(false, {transform});
  readonly zSize = input<ZardInputSizeVariants>('default');
  readonly zStatus = input<ZardInputStatusVariants>();
  readonly value = model<string>('');

  readonly size = linkedSignal<ZardInputSizeVariants>(() => this.zSize());

  protected readonly classes = computed(() =>
    mergeClasses(
      inputVariants({
        zType: this.getType(),
        zSize: this.size(),
        zStatus: this.zStatus(),
        zBorderless: this.zBorderless(),
      }),
      this.class(),
    ),
  );

  protected readonly isInvalid = computed(() => this.zStatus() === 'error');

  protected readonly describedBy = computed(() => {
    const status = this.zStatus();
    const id = this.elementRef.nativeElement.id;
    return status === 'error' && id ? `${id}-error` : null;
  });

  private valueInitialized = false;

  constructor() {
    effect(() => {
      const value = this.value();

      // Skip the initial effect run to avoid overwriting reactive form values
      // The effect should only sync when the model value is explicitly changed
      if (!this.valueInitialized) {
        this.valueInitialized = true;
        if (value) {
          this.elementRef.nativeElement.value = value;
        }
        return;
      }

      if (value !== undefined && value !== null) {
        this.elementRef.nativeElement.value = value;
      }
    });
  }

  ngAfterViewInit(): void {
    this.removePasswordPlaceholder();

    if (typeof MutationObserver === 'undefined') {
      return;
    }

    this.passwordPlaceholderObserver = new MutationObserver(() => {
      this.removePasswordPlaceholder();
    });
    this.passwordPlaceholderObserver.observe(this.elementRef.nativeElement, {
      attributes: true,
      attributeFilter: ['autocomplete', 'placeholder', 'type'],
    });
  }

  ngOnDestroy(): void {
    this.passwordPlaceholderObserver?.disconnect();
  }

  disable(b: boolean): void {
    this.elementRef.nativeElement.disabled = b;
  }

  setDataSlot(name: string): void {
    if (this.elementRef?.nativeElement?.dataset) {
      this.elementRef.nativeElement.dataset.slot = name;
    }
  }

  protected updateValue(target: EventTarget | null): void {
    const value = readInputValue(target);
    if (value !== null) {
      this.value.set(value);
      return;
    }

    this.value.set('');
  }

  getType(): ZardInputTypeVariants {
    const isTextarea =
      this.elementRef.nativeElement.tagName.toLowerCase() === 'textarea';
    return isTextarea ? 'textarea' : 'default';
  }

  // Placeholder text on password fields leaks credential length hints to shoulder-surfers and screen readers.
  private removePasswordPlaceholder(): void {
    const element = this.elementRef.nativeElement;
    if (!this.isPasswordField() || !element.hasAttribute('placeholder')) {
      return;
    }

    element.removeAttribute('placeholder');
  }

  private isPasswordField(): boolean {
    const element = this.elementRef.nativeElement;
    if (element.tagName.toLowerCase() !== 'input') {
      return false;
    }

    const inputElement = element as HTMLInputElement;
    const autocomplete = inputElement
      .getAttribute('autocomplete')
      ?.toLowerCase();
    return (
      inputElement.type.toLowerCase() === 'password' ||
      autocomplete === 'current-password' ||
      autocomplete === 'new-password'
    );
  }
}
