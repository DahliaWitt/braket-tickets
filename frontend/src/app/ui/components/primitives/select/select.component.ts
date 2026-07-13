import {
  Overlay,
  OverlayModule,
  OverlayPositionBuilder,
  type OverlayRef,
} from '@angular/cdk/overlay';
import {TemplatePortal} from '@angular/cdk/portal';
import {isPlatformBrowser, NgTemplateOutlet} from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChildren,
  DestroyRef,
  effect,
  ElementRef,
  forwardRef,
  inject,
  Injector,
  input,
  model,
  type OnDestroy,
  output,
  PLATFORM_ID,
  signal,
  type TemplateRef,
  viewChild,
  ViewContainerRef,
} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {type ControlValueAccessor, NG_VALUE_ACCESSOR} from '@angular/forms';

import type {ClassValue} from 'clsx';
import {filter} from 'rxjs';

import {
  navigateItems,
  focusItemAtIndex,
  selectFocusedItem,
  NAVIGATION_KEYS,
  type KeyboardNavKey,
} from '@ui/utils/keyboard-navigation';

import {ZardSelectItemComponent} from './select-item.component';
import {
  provideLabelForSingleSelectMode,
  provideLabelsForMultiselectMode,
} from './select-labels';
import {focusSelectButton, focusSelectDropdown} from './select-focus';
import {determineOverlayWidthOnOpen} from './select-overlay-width';
import {
  selectContentVariants,
  selectTriggerVariants,
  selectVariants,
  type ZardSelectSizeVariants,
} from './select.variants';
import {ZardBadgeComponent} from '@ui/components/primitives/badge/badge.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';

import {mergeClasses, transform} from '@ui/utils/merge-classes';
import {logger} from '@/utils/logger';

type OnTouchedType = () => void;
type OnChangeType = (value: string | string[]) => void;

const COMPACT_MODE_WIDTH_THRESHOLD = 100;

function coerceSelectValues(
  value: string | string[] | null | undefined,
  multiple: boolean,
): string[] {
  if (multiple) {
    return Array.isArray(value) ? value : value ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.length ? [value[0]] : [];
  }

  return value ? [value] : [];
}

function coerceSelectValue(
  value: string | string[] | null | undefined,
  multiple: boolean,
): string | string[] {
  if (multiple && (value === null || value === undefined)) {
    return [];
  }

  const selectedValues = coerceSelectValues(value, multiple);
  return multiple ? selectedValues : (selectedValues[0] ?? '');
}

@Component({
  selector: 'z-select, [z-select]',
  imports: [
    NgTemplateOutlet,
    OverlayModule,
    ZardBadgeComponent,
    ZardIconComponent,
  ],
  templateUrl: './select.component.html',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ZardSelectComponent),
      multi: true,
    },
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-active]': 'isFocus() ? "" : null',
    '[attr.data-disabled]': 'isDisabled() ? "" : null',
    '[attr.data-state]': 'isOpen() ? "open" : "closed"',
    '[class]': 'classes()',
  },
})
export class ZardSelectComponent implements ControlValueAccessor, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly overlay = inject(Overlay);
  private readonly overlayPositionBuilder = inject(OverlayPositionBuilder);
  private readonly viewContainerRef = inject(ViewContainerRef);
  private readonly platformId = inject(PLATFORM_ID);

  readonly dropdownTemplate =
    viewChild.required<TemplateRef<void>>('dropdownTemplate');
  readonly selectItems = contentChildren(ZardSelectItemComponent);

  private overlayRef?: OverlayRef;
  private portal?: TemplatePortal;

  readonly class = input<ClassValue>('');
  readonly zAriaLabel = input<string>('');
  readonly zAriaLabelledBy = input<string>('');
  readonly zDisabled = input(false, {transform});
  readonly zLabel = input<string>('');
  readonly zMaxLabelCount = input<number>(1);
  readonly zMultiple = input<boolean>(false);
  readonly zPlaceholder = input<string>('Select an option...');
  readonly zSize = input<ZardSelectSizeVariants>('default');
  readonly zValue = model<string | string[]>(this.zMultiple() ? [] : '');

  readonly zSelectionChange = output<string | string[]>();

  readonly isOpen = signal(false);
  readonly focusedIndex = signal<number>(-1);
  protected readonly isFocus = signal(false);
  protected readonly isCompact = signal(false);
  private readonly cvaDisabled = signal(false);
  protected readonly isDisabled = computed(
    () => this.zDisabled() || this.cvaDisabled(),
  );

  protected readonly focusedItemId = computed(() => {
    const index = this.focusedIndex();
    if (index < 0) {
      return null;
    }
    // focusedIndex is maintained in the enabled-only index space used by
    // keyboard navigation: getSelectItems() filters out disabled options
    // before navigating. aria-activedescendant must resolve against the same
    // enabled-only list so it references the actually-highlighted option.
    // Resolving against the full contentChildren list (which includes disabled
    // items) shifts the announced id by one per preceding disabled option.
    const enabledItems = this.selectItems().filter((item) => !item.zDisabled());
    return enabledItems[index]?.id ?? null;
  });

  protected onFocus(): void {
    if (this.isCompact()) {
      this.isFocus.set(true);
    }
  }

  readonly selectedLabels = computed<string[]>(() => {
    const selectedValues = coerceSelectValues(this.zValue(), this.zMultiple());
    const items = this.selectItems();
    if (this.zMultiple()) {
      return provideLabelsForMultiselectMode(
        selectedValues,
        this.zMaxLabelCount(),
        items,
      );
    }

    return provideLabelForSingleSelectMode(
      selectedValues[0] ?? '',
      this.zLabel(),
      items,
    );
  });

  private onChange: OnChangeType = (_value: string | string[]) => {
    // ControlValueAccessor onChange callback
  };

  private onTouched: OnTouchedType = () => {
    // ControlValueAccessor onTouched callback
  };

  protected readonly classes = computed(() =>
    mergeClasses(selectVariants(), this.class()),
  );
  protected readonly contentClasses = computed(() =>
    mergeClasses(selectContentVariants()),
  );
  protected readonly triggerClasses = computed(() =>
    mergeClasses(
      selectTriggerVariants({
        zSize: this.zSize(),
      }),
    ),
  );

  constructor() {
    effect(() => {
      const normalizedValue = coerceSelectValue(
        this.zValue(),
        this.zMultiple(),
      );
      if (normalizedValue !== this.zValue()) {
        this.zValue.set(normalizedValue);
      }
    });

    // Use effect to handle dynamically added select items (e.g., from @for loops)
    // This replaces ngAfterContentInit to ensure items added after initial render are properly initialized
    effect(() => {
      const items = this.selectItems();
      const hostWidth = this.elementRef.nativeElement.offsetWidth || 0;

      for (const item of items) {
        item.setSelectHost({
          selectedValue: () =>
            coerceSelectValues(this.zValue(), this.zMultiple()),
          selectItem: (value: string, label: string) =>
            this.selectItem(value, label),
        });
        item.zSize.set(this.zSize());

        if (hostWidth <= COMPACT_MODE_WIDTH_THRESHOLD) {
          this.isCompact.set(true);
          item.zMode.set('compact');
        }
      }
    });
  }

  ngOnDestroy() {
    this.destroyOverlay();
  }

  onTriggerKeydown(event: Event) {
    const {key} = event as KeyboardEvent;
    switch (key) {
      case 'Enter':
      case ' ':
      case 'ArrowDown':
      case 'ArrowUp':
        if (!this.isOpen()) {
          this.open();
        }
        break;
      case 'Escape':
        if (this.isOpen()) {
          this.close();
          // The open dropdown consumed the Escape, so stop it from bubbling to
          // the CDK keyboard dispatcher on <body> where a host dialog would
          // otherwise treat it as its own Escape and close. When the select is
          // already closed we deliberately let Escape propagate so it can close
          // an enclosing dialog.
          event.stopPropagation();
        }
        break;
    }
  }

  onDropdownKeydown(e: Event) {
    const {key} = e as KeyboardEvent;
    const items = this.getSelectItems();
    const navKey = key as KeyboardNavKey;

    if (!NAVIGATION_KEYS.includes(navKey)) {
      return;
    }

    e.preventDefault();

    switch (navKey) {
      case 'ArrowDown':
        navigateItems(1, items, this.focusedIndex(), (idx) =>
          focusItemAtIndex(items, idx, (i) => this.focusedIndex.set(i)),
        );
        break;
      case 'ArrowUp':
        navigateItems(-1, items, this.focusedIndex(), (idx) =>
          focusItemAtIndex(items, idx, (i) => this.focusedIndex.set(i)),
        );
        break;
      case 'Enter':
      case ' ':
        this.selectFocusedItem(items);
        break;
      case 'Escape':
        this.close();
        focusSelectButton(this.elementRef);
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

  toggle() {
    if (this.isDisabled()) {
      return;
    }

    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
    }
  }

  selectItem(value: string, label: string) {
    // Only reject truly invalid values (undefined/null), but allow empty strings
    // as they can be valid intentional values (e.g., "None" option)
    if (value === undefined || value === null) {
      logger.warn('Attempted to select item with invalid value:', {
        value,
        label,
      });
      return;
    }

    this.zValue.update((selectedValues) => {
      if (this.zMultiple()) {
        const currentValues = coerceSelectValues(selectedValues, true);
        return currentValues.includes(value)
          ? currentValues.filter((v) => v !== value)
          : [...currentValues, value];
      }

      return value;
    });
    this.onChange(this.zValue());
    this.zSelectionChange.emit(this.zValue());

    if (this.zMultiple()) {
      // in multiple mode it can happen that button changes size because of selection badges,
      // which requires overlay position to update
      this.updateOverlayPosition();
    } else {
      this.close();

      // Return focus to the button after selection
      setTimeout(() => {
        focusSelectButton(this.elementRef);
      }, 0);
    }
  }

  private updateOverlayPosition(): void {
    setTimeout(() => {
      this.overlayRef?.updatePosition();
    }, 0);
  }

  private open() {
    if (this.isOpen()) {
      return;
    }

    // Create overlay if it doesn't exist
    if (!this.overlayRef) {
      this.createOverlay();
    }

    if (!this.overlayRef) {
      return;
    }

    const hostWidth = this.elementRef.nativeElement.offsetWidth || 0;

    if (this.overlayRef.hasAttached()) {
      this.overlayRef.detach();
    }

    this.portal = new TemplatePortal(
      this.dropdownTemplate(),
      this.viewContainerRef,
    );

    this.overlayRef.attach(this.portal);
    this.overlayRef.updateSize({width: hostWidth});
    this.isOpen.set(true);

    determineOverlayWidthOnOpen({
      injector: this.injector,
      overlayRef: this.overlayRef,
      portalWidth: hostWidth,
      selectItems: this.selectItems(),
      onReady: () => {
        focusSelectDropdown(this.overlayRef);
        this.focusSelectedItem();
      },
    });
  }

  private close() {
    if (this.overlayRef?.hasAttached()) {
      this.overlayRef.detach();
    }
    this.isOpen.set(false);
    this.focusedIndex.set(-1);
    this.onTouched();
  }

  private createOverlay() {
    if (this.overlayRef) {
      return;
    } // Already created

    if (isPlatformBrowser(this.platformId)) {
      try {
        const positionStrategy = this.overlayPositionBuilder
          .flexibleConnectedTo(this.elementRef)
          .withPositions([
            {
              originX: 'center',
              originY: 'bottom',
              overlayX: 'center',
              overlayY: 'top',
              offsetY: 4,
            },
            {
              originX: 'center',
              originY: 'top',
              overlayX: 'center',
              overlayY: 'bottom',
              offsetY: -4,
            },
          ])
          .withPush(false);

        const elementWidth = this.elementRef.nativeElement.offsetWidth || 200;

        this.overlayRef = this.overlay.create({
          positionStrategy,
          hasBackdrop: false,
          scrollStrategy: this.overlay.scrollStrategies.reposition(),
          width: elementWidth,
          maxHeight: 384, // max-h-96 equivalent
        });
        this.overlayRef
          .outsidePointerEvents()
          .pipe(
            filter((event) => {
              const target = event.target;
              if (!(target instanceof Node)) return true;
              return !this.elementRef.nativeElement.contains(target);
            }),
            takeUntilDestroyed(this.destroyRef),
          )
          .subscribe(() => {
            this.isFocus.set(false);
            this.close();
          });
      } catch (error) {
        logger.error('Error creating overlay:', error);
      }
    }
  }

  private destroyOverlay() {
    if (this.overlayRef) {
      this.overlayRef.dispose();
      this.overlayRef = undefined;
    }
  }

  private getSelectItems(): HTMLElement[] {
    if (!this.overlayRef?.hasAttached()) {
      return [];
    }
    const dropdownElement = this.overlayRef.overlayElement;
    return Array.from(
      dropdownElement.querySelectorAll<HTMLElement>(
        'z-select-item, [z-select-item]',
      ),
    ).filter((item) => item.dataset['disabled'] === undefined);
  }

  private selectFocusedItem(items: HTMLElement[]) {
    const item = selectFocusedItem(items, this.focusedIndex());
    if (!item) {
      return;
    }
    const value = item.getAttribute('value');
    const label = item.textContent?.trim() ?? '';

    if (value === null || value === undefined) {
      logger.warn('No value attribute found on selected item:', item);
      return;
    }

    this.selectItem(value, label);
  }

  private updateItemFocus(items: HTMLElement[], focusedIndex: number) {
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (index === focusedIndex) {
        item.focus();
        item.setAttribute('aria-selected', 'true');
        item.setAttribute('data-selected', 'true');
      } else {
        item.removeAttribute('aria-selected');
        item.removeAttribute('data-selected');
      }
    }
  }

  private focusSelectedItem() {
    const items = this.getSelectItems();
    if (items.length === 0) {
      return;
    }

    // Find the index of the currently selected item
    const currentValue = this.zValue();
    let selectedValue: string | undefined;
    if (Array.isArray(currentValue) && currentValue.length) {
      [selectedValue] = currentValue;
    } else if (
      typeof currentValue === 'string' &&
      (!this.zMultiple() || currentValue)
    ) {
      selectedValue = currentValue;
    }

    let selectedIndex = selectedValue
      ? items.findIndex((item) => item.getAttribute('value') === selectedValue)
      : -1;

    // If no item is selected, focus the first item
    if (selectedIndex === -1) {
      selectedIndex = 0;
    }

    this.focusedIndex.set(selectedIndex);
    this.updateItemFocus(items, selectedIndex);
  }

  // ControlValueAccessor implementation
  writeValue(value: string | string[] | null): void {
    this.zValue.set(coerceSelectValue(value, this.zMultiple()));
  }

  registerOnChange(fn: (value: string | string[]) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.cvaDisabled.set(isDisabled);
  }
}
