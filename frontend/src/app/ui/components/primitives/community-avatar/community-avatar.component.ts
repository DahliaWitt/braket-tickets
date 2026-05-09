import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
  ViewEncapsulation,
} from '@angular/core';
import {NgOptimizedImage} from '@angular/common';

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
  imports: [NgOptimizedImage],
  host: {
    '[class]': 'hostClasses()',
    '[attr.data-size]': 'size()',
  },
  template: `
    @if (showImage()) {
      <img
        [ngSrc]="logoUrl()!"
        [alt]="name() + ' logo'"
        fill
        ngSrcset="80w, 160w"
        sizes="64px"
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
      // `relative` is required so child `<img fill>` positions against the host.
      'relative inline-flex',
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

  // `fill` already sets position: absolute / inset: 0 / 100% × 100% inline,
  // so only object-fit is load-bearing here.
  protected readonly imageClasses = computed(() => 'object-cover');

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
