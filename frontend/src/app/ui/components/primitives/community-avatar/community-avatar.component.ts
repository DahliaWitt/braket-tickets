import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  ViewEncapsulation,
} from '@angular/core';

import {
  communityAvatarContainerVariants,
  communityAvatarInitialVariants,
  communityAvatarShapeClass,
  type BraCommunityAvatarVariants,
} from './community-avatar.variants';
import {mergeClasses} from '@ui/utils/merge-classes';

@Component({
  selector: 'bra-community-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'hostClasses()',
    '[attr.data-size]': 'size()',
  },
  template: `
    @if (logoUrl()) {
      <img
        [src]="logoUrl()"
        [alt]="name() + ' logo'"
        loading="lazy"
        decoding="async"
        [class]="imageClasses()"
      />
    } @else {
      <div [class]="fallbackClasses()">
        <span
          data-testid="community-avatar-initial"
          [class]="initialClasses()"
          aria-hidden="true"
          >{{ initial() }}</span
        >
      </div>
    }
  `,
  exportAs: 'braCommunityAvatar',
})
export class BraCommunityAvatarComponent {
  readonly logoUrl = input<string | null | undefined>();
  readonly name = input.required<string>();
  readonly size = input<NonNullable<BraCommunityAvatarVariants['size']>>('md');
  readonly shape =
    input<NonNullable<BraCommunityAvatarVariants['shape']>>('rounded');
  readonly muted = input(false, {transform: booleanAttribute});

  protected readonly hostClasses = computed(() =>
    mergeClasses('inline-flex', communityAvatarShapeClass(this.shape())),
  );

  protected readonly initial = computed(
    () => this.name().trim().charAt(0).toUpperCase() || '?',
  );

  protected readonly imageClasses = computed(() =>
    mergeClasses(
      communityAvatarContainerVariants({
        size: this.size(),
        shape: this.shape(),
      }),
      'object-cover',
    ),
  );

  protected readonly fallbackClasses = computed(() =>
    mergeClasses(
      communityAvatarContainerVariants({
        size: this.size(),
        shape: this.shape(),
      }),
      'flex items-center justify-center border border-border bg-primary/[0.06]',
    ),
  );

  protected readonly initialClasses = computed(() =>
    mergeClasses(
      communityAvatarInitialVariants({size: this.size()}),
      this.muted() ? 'text-muted-foreground/60' : 'text-primary',
    ),
  );
}
