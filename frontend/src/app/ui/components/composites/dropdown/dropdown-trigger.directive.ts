import {
  afterNextRender,
  computed,
  Directive,
  ElementRef,
  inject,
  input,
  ViewContainerRef,
} from '@angular/core';

import type {BraDropdownMenuContentComponent} from './dropdown-menu-content.component';
import {BraDropdownService} from './dropdown.service';

let nextDropdownId = 0;

@Directive({
  selector: '[bra-dropdown], [braDropdown]',
  host: {
    '[attr.id]': 'triggerId',
    '[attr.tabindex]': '0',
    '[attr.role]': '"button"',
    '[attr.aria-haspopup]': '"menu"',
    '[attr.aria-expanded]': 'isExpanded()',
    '[attr.aria-controls]': 'isExpanded() ? menuId : null',
    '[attr.aria-disabled]': 'zDisabled()',
    '(click.prevent-with-stop)': 'onClick()',
    '(mouseenter)': 'onHoverToggle()',
    '(mouseleave)': 'onHoverToggle()',
    '(keydown.{enter,space}.prevent-with-stop)': 'toggleDropdown()',
    '(keydown.arrowdown.prevent)': 'openDropdown()',
  },
  exportAs: 'braDropdown',
})
export class BraDropdownDirective {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly viewContainerRef = inject(ViewContainerRef);
  protected readonly dropdownService = inject(BraDropdownService);

  private readonly dropdownId = nextDropdownId++;
  readonly triggerId =
    this.elementRef.nativeElement.id ||
    `bra-dropdown-trigger-${this.dropdownId}`;
  readonly menuId = `bra-dropdown-menu-${this.dropdownId}`;

  readonly braDropdownMenu = input<BraDropdownMenuContentComponent>();
  readonly zTrigger = input<'click' | 'hover'>('click');
  readonly zDisabled = input<boolean>(false);

  protected readonly isExpanded = computed(
    () =>
      this.dropdownService.activeTrigger() === this.elementRef.nativeElement,
  );

  constructor() {
    afterNextRender(() => {
      const element = this.elementRef.nativeElement;
      if (
        !element.hasAttribute('aria-label') &&
        !element.hasAttribute('aria-labelledby')
      ) {
        const label = element.textContent?.trim();
        element.setAttribute('aria-label', label?.length ? label : 'Open menu');
      }
    });
  }

  protected onClick() {
    if (this.zTrigger() !== 'click') {
      return;
    }

    this.toggleDropdown();
  }

  protected onHoverToggle() {
    if (this.zTrigger() !== 'hover') {
      return;
    }

    this.toggleDropdown();
  }

  protected toggleDropdown() {
    if (this.zDisabled()) {
      return;
    }

    const menuContent = this.braDropdownMenu();
    if (menuContent) {
      this.dropdownService.toggle(
        this.elementRef,
        menuContent.contentTemplate(),
        this.viewContainerRef,
        this.menuId,
        this.triggerId,
      );
    }
  }

  protected openDropdown() {
    if (this.zDisabled()) {
      return;
    }

    const menuContent = this.braDropdownMenu();
    if (menuContent && !this.isExpanded()) {
      this.dropdownService.toggle(
        this.elementRef,
        menuContent.contentTemplate(),
        this.viewContainerRef,
        this.menuId,
        this.triggerId,
      );
    }
  }
}
