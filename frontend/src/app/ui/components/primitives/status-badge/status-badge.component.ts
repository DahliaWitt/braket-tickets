import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  ViewEncapsulation,
} from '@angular/core';

import type { ClassValue } from 'clsx';

import { statusBadgeVariants, type BraStatusBadgeVariants } from './status-badge.variants';
import { mergeClasses } from '@ui/utils/merge-classes';

@Component({
  selector: 'bra-status-badge',
  template: `<ng-content />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'classes()',
    '[attr.data-status]': 'status()',
    '[attr.role]': 'live() ? "status" : null',
    '[attr.aria-live]': 'live() ? "polite" : null',
  },
  exportAs: 'braStatusBadge',
})
export class BraStatusBadgeComponent {
  readonly status = input<NonNullable<BraStatusBadgeVariants['status']>>('muted');
  readonly size = input<NonNullable<BraStatusBadgeVariants['size']>>('sm');
  readonly shape = input<NonNullable<BraStatusBadgeVariants['shape']>>('rounded');
  readonly live = input(false, { transform: booleanAttribute });
  readonly class = input<ClassValue>('');

  protected readonly classes = computed(() =>
    mergeClasses(
      statusBadgeVariants({
        status: this.status(),
        size: this.size(),
        shape: this.shape(),
      }),
      this.class(),
    ),
  );
}
