import {describe, expect, it} from 'vitest';

import {
  containerProgressBarVariants,
  progressBarVariants,
} from './progress-bar.variants';

const tokens = (classes: string): string[] => classes.split(/\s+/);

describe('progress bar variants', () => {
  it('points the accent fill and track at real theme tokens (no chart-* indirection)', () => {
    const fill = tokens(progressBarVariants({zType: 'accent'}));
    const track = tokens(containerProgressBarVariants({zType: 'accent'}));

    expect(fill).toContain('bg-accent');
    expect(track).toContain('bg-accent/20');
    expect(fill.join(' ')).not.toContain('chart-1');
    expect(track.join(' ')).not.toContain('chart-1');
  });

  it('keeps the size scale ascending: sm < default < lg', () => {
    const heightOf = (size: 'sm' | 'default' | 'lg'): number => {
      const token = tokens(containerProgressBarVariants({zSize: size})).find(
        (c) => /^h-[\d.]+$/.test(c),
      );
      expect(token).toBeDefined();
      return Number(token!.slice(2));
    };

    expect(heightOf('sm')).toBe(1.5);
    expect(heightOf('default')).toBe(2);
    expect(heightOf('lg')).toBe(5);
    expect(heightOf('sm')).toBeLessThan(heightOf('default'));
    expect(heightOf('default')).toBeLessThan(heightOf('lg'));
  });
});
