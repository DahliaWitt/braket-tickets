import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  ViewEncapsulation,
} from '@angular/core';
import {DomSanitizer} from '@angular/platform-browser';

import type {ClassValue} from 'clsx';

import {iconVariants, type ZardIconVariants} from './icon.variants';
import {ZARD_ICONS, type LucideIconData, type ZardIcon} from './icons';

import {mergeClasses} from '@ui/utils/merge-classes';

@Component({
  selector: 'z-icon, [z-icon]',
  template: `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      [attr.stroke-width]="zStrokeWidth()"
      [class]="classes()"
      [innerHTML]="svgContent()"
    ></svg>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    '[attr.aria-hidden]': '"true"',
  },
})
export class ZardIconComponent {
  private readonly sanitizer = inject(DomSanitizer);

  readonly zType = input.required<ZardIcon>();
  readonly zSize = input<ZardIconVariants['zSize']>('default');
  readonly zStrokeWidth = input<number>(2);
  readonly zAbsoluteStrokeWidth = input<boolean>(false);
  readonly class = input<ClassValue>('');

  protected readonly classes = computed(() =>
    mergeClasses(
      iconVariants({zSize: this.zSize()}),
      this.class(),
      this.zStrokeWidth() === 0 ? 'stroke-none' : '',
    ),
  );

  protected readonly icon = computed(() => {
    const type = this.zType();
    if (typeof type === 'string') {
      return ZARD_ICONS[type];
    }

    return type;
  });

  protected readonly svgContent = computed(() =>
    this.sanitizer.bypassSecurityTrustHtml(
      renderIconMarkup(this.icon(), this.zAbsoluteStrokeWidth()),
    ),
  );
}

function renderIconMarkup(
  icon: LucideIconData,
  absoluteStrokeWidth: boolean,
): string {
  return icon
    .map(([nodeName, attrs]) => {
      const mergedAttrs = absoluteStrokeWidth
        ? {...attrs, 'vector-effect': 'non-scaling-stroke'}
        : attrs;

      return `<${nodeName}${serializeAttributes(mergedAttrs)}></${nodeName}>`;
    })
    .join('');
}

function serializeAttributes(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join('');
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
