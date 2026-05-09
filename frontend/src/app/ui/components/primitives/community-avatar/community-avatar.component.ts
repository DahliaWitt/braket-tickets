import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
  ViewEncapsulation,
} from '@angular/core';

import {
  communityAvatarContainerVariants,
  communityAvatarInitialVariants,
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
    @if (showImage()) {
      <img
        [src]="logoUrl()"
        [alt]="name() + ' logo'"
        loading="lazy"
        decoding="async"
        [class]="imageClasses()"
        (error)="onLogoError()"
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
  private readonly failedLogoUrl = signal<string | null>(null);

  readonly logoUrl = input<string | null | undefined>();
  readonly name = input.required<string>();
  readonly size = input<NonNullable<BraCommunityAvatarVariants['size']>>('md');
  readonly shape =
    input<NonNullable<BraCommunityAvatarVariants['shape']>>('rounded');
  readonly muted = input(false, {transform: booleanAttribute});

  protected readonly hostClasses = computed(() =>
    mergeClasses(
      'inline-flex',
      communityAvatarContainerVariants({
        size: this.size(),
        shape: this.shape(),
      }),
    ),
  );

  protected readonly showImage = computed(() => {
    const url = this.logoUrl();
    return !!url && this.failedLogoUrl() !== url;
  });

  protected onLogoError(): void {
    this.failedLogoUrl.set(this.logoUrl() ?? null);
  }

  protected readonly imageClasses = computed(() =>
    mergeClasses('h-full w-full object-cover'),
  );

  protected readonly initial = computed(
    () => this.name().trim().charAt(0).toUpperCase() || '?',
  );

  protected readonly fallbackClasses = computed(() =>
    mergeClasses(
      'flex h-full w-full items-center justify-center border border-border bg-primary/[0.06]',
    ),
  );

  protected readonly initialClasses = computed(() =>
    mergeClasses(
      communityAvatarInitialVariants({size: this.size()}),
      this.muted() ? 'text-muted-foreground/60' : 'text-primary',
    ),
  );
}
