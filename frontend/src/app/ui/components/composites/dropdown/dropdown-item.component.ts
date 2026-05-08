import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  ViewEncapsulation,
} from '@angular/core';

import type { ClassValue } from 'clsx';

import { BraDropdownService } from './dropdown.service';
import { dropdownItemVariants, type BraDropdownItemVariants } from './dropdown.variants';

import { mergeClasses, transform } from '@ui/utils/merge-classes';

type MenuItemRole = 'menuitem' | 'menuitemradio' | 'menuitemcheckbox';

@Component({
  selector: 'bra-dropdown-menu-item, [bra-dropdown-menu-item]',
  template: ` <ng-content /> `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'classes()',
    '[attr.data-disabled]': 'disabled() || null',
    '[attr.data-variant]': 'variant()',
    '[attr.data-inset]': 'inset() || null',
    '[attr.aria-disabled]': 'disabled() ? "true" : null',
    '[attr.role]': 'role()',
    '(click.prevent-with-stop)': 'onClick()',
    '[attr.tabindex]': '"-1"',
  },
  exportAs: 'braDropdownMenuItem',
})
export class BraDropdownMenuItemComponent {
  private readonly dropdownService = inject(BraDropdownService);

  readonly variant = input<BraDropdownItemVariants['variant']>('default');
  readonly inset = input(false, { transform });
  readonly disabled = input(false, { transform });
  readonly class = input<ClassValue>('');
  readonly role = input<MenuItemRole>('menuitem');

  onClick() {
    if (this.disabled()) {
      return;
    }

    // Fechar dropdown após click
    setTimeout(() => {
      this.dropdownService.close();
    }, 0);
  }

  protected readonly classes = computed(() =>
    mergeClasses(
      dropdownItemVariants({
        variant: this.variant(),
        inset: this.inset(),
      }),
      this.class(),
    ),
  );
}
