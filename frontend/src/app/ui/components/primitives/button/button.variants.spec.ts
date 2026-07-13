import {describe, expect, it} from 'vitest';

import {buttonVariants} from './button.variants';

describe('buttonVariants', () => {
  it('uses the neutral foreground wash for outline hover (same approach as ghost)', () => {
    const classes = buttonVariants({zType: 'outline'});

    expect(classes).toContain('hover:bg-foreground/10');
    expect(classes).toContain('hover:text-foreground');
    expect(classes).not.toContain('hover:bg-accent');
    expect(classes).not.toContain('hover:text-accent-foreground');
  });

  it('keeps the outline border/background base and the neutral dark-mode hover', () => {
    const classes = buttonVariants({zType: 'outline'});

    expect(classes).toContain('bg-background');
    expect(classes).toContain('dark:hover:bg-input/50');
  });
});
