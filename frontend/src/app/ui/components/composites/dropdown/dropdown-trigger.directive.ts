import {
  afterNextRender,
  computed,
  DestroyRef,
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
    '(mouseenter)': 'onHoverEnter()',
    '(mouseleave)': 'onHoverLeave()',
    '(keydown.{enter,space}.prevent-with-stop)': 'toggleDropdown()',
    '(keydown.arrowdown.prevent)': 'openDropdown()',
  },
  exportAs: 'braDropdown',
})
export class BraDropdownDirective {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly viewContainerRef = inject(ViewContainerRef);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly dropdownService = inject(BraDropdownService);

  private readonly dropdownId = nextDropdownId++;
  readonly triggerId =
    this.elementRef.nativeElement.id ||
    `bra-dropdown-trigger-${this.dropdownId}`;
  readonly menuId = `bra-dropdown-menu-${this.dropdownId}`;

  readonly braDropdownMenu = input<BraDropdownMenuContentComponent>();
  readonly zTrigger = input<'click' | 'hover'>('click');
  readonly zDisabled = input<boolean>(false);
  /**
   * Grace period (ms) before a hover menu closes after the pointer leaves the
   * trigger, giving it time to travel across the gap into the menu.
   */
  readonly zHoverGrace = input<number>(200);

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

    // If this trigger is destroyed while its hover menu is open (or a close is
    // pending), dispose the overlay and cancel the timer so nothing leaks.
    this.destroyRef.onDestroy(() => {
      if (this.isExpanded()) {
        this.dropdownService.close();
      }
    });
  }

  protected onClick() {
    if (this.zTrigger() !== 'click') {
      return;
    }

    this.toggleDropdown();
  }

  protected onHoverEnter() {
    if (this.zTrigger() !== 'hover' || this.zDisabled()) {
      return;
    }

    const menuContent = this.braDropdownMenu();
    if (!menuContent) {
      return;
    }

    this.dropdownService.openHover(
      this.elementRef,
      menuContent.contentTemplate(),
      this.viewContainerRef,
      this.menuId,
      this.triggerId,
      this.zHoverGrace(),
    );
  }

  protected onHoverLeave() {
    if (this.zTrigger() !== 'hover') {
      return;
    }

    // Delay the close so the pointer can reach the menu; entering the menu (or
    // re-entering the trigger) cancels it.
    this.dropdownService.scheduleHoverClose();
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
