import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'z-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      [class]="classes()"
      [style.width]="width()"
      [style.height]="height()"
      role="presentation"
      aria-hidden="true"
    ></div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class ZardSkeletonComponent {
  readonly class = input<string>('');
  readonly width = input<string>();
  readonly height = input<string>();
  readonly zAnimation = input<'pulse' | 'shimmer'>('pulse');

  protected readonly classes = computed(() => {
    const animClass = this.zAnimation() === 'shimmer' ? 'animate-shimmer' : 'animate-pulse';
    const baseClasses = `${animClass} rounded-md bg-muted/50`;
    return this.class() ? `${baseClasses} ${this.class()}` : baseClasses;
  });
}
