import { afterNextRender, Directive, ElementRef, inject, input, ViewContainerRef } from '@angular/core';

import type { BraDropdownMenuContentComponent } from './dropdown-menu-content.component';
import { BraDropdownService } from './dropdown.service';

@Directive({
  selector: '[bra-dropdown], [braDropdown]',
  host: {
    '[attr.tabindex]': '0',
    '[attr.role]': '"button"',
    '[attr.aria-haspopup]': '"menu"',
    '[attr.aria-expanded]': 'dropdownService.isOpen()',
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

  readonly braDropdownMenu = input<BraDropdownMenuContentComponent>();
  readonly zTrigger = input<'click' | 'hover'>('click');
  readonly zDisabled = input<boolean>(false);

  constructor() {
    afterNextRender(() => {
      // Ensure button has proper accessibility attributes
      const element = this.elementRef.nativeElement;
      if (!element.hasAttribute('aria-label') && !element.hasAttribute('aria-labelledby')) {
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
      );
    }
  }

  protected openDropdown() {
    if (this.zDisabled()) {
      return;
    }

    const menuContent = this.braDropdownMenu();
    if (menuContent && !this.dropdownService.isOpen()) {
      this.dropdownService.toggle(
        this.elementRef,
        menuContent.contentTemplate(),
        this.viewContainerRef,
      );
    }
  }
}
