import {describe, expect, it} from 'vitest';

import {badgeVariants} from './badge.variants';

const tokens = (classes: string): string[] => classes.split(/\s+/);

describe('badgeVariants', () => {
  it('uses the neutral foreground wash for outline link hover', () => {
    const classes = badgeVariants({zType: 'outline'});

    expect(classes).toContain('[a&]:hover:bg-foreground/10');
    expect(classes).toContain('[a&]:hover:text-foreground');
    expect(classes).not.toContain('hover:bg-accent');
    expect(classes).not.toContain('hover:text-accent-foreground');
  });

  it('uses the AA-calibrated secondary text token on the soft secondary tint', () => {
    const list = tokens(
      badgeVariants({zType: 'secondary', zAppearance: 'soft'}),
    );

    expect(list).toContain('text-secondary-text');
    // bare text-secondary fails AA on the bg-secondary/10 underlay
    expect(list).not.toContain('text-secondary');
  });
});
