import {describe, expect, it} from 'vitest';

import {selectTriggerVariants} from './select.variants';

const tokens = (classes: string): string[] => classes.split(/\s+/);

describe('selectTriggerVariants', () => {
  it('aligns the default size with the input scale (min-h-11 / px-4 / text-base)', () => {
    const defaults = tokens(selectTriggerVariants());

    expect(defaults).toContain('min-h-11');
    expect(defaults).toContain('px-4');
    expect(defaults).toContain('text-base');
  });

  it('keeps the height scale ascending: sm < default < lg', () => {
    expect(tokens(selectTriggerVariants({zSize: 'sm'}))).toContain('min-h-8');
    expect(tokens(selectTriggerVariants({zSize: 'default'}))).toContain(
      'min-h-11',
    );
    expect(tokens(selectTriggerVariants({zSize: 'lg'}))).toContain('min-h-12');
  });

  it('uses the same focus recipe as inputs (ring-[3px] at ring/50)', () => {
    const defaults = tokens(selectTriggerVariants());

    expect(defaults).toContain('focus-visible:border-ring');
    expect(defaults).toContain('focus-visible:ring-ring/50');
    expect(defaults).toContain('focus-visible:ring-[3px]');
    expect(defaults).not.toContain('focus-visible:ring-ring/15');
  });
});
