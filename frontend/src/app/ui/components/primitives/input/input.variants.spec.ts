import {describe, expect, it} from 'vitest';

import {inputVariants} from './input.variants';

const tokens = (classes: string): string[] => classes.split(/\s+/);

describe('inputVariants', () => {
  it('keeps the height scale ascending: sm < default < lg', () => {
    expect(tokens(inputVariants({zSize: 'sm'}))).toContain('h-8');
    expect(tokens(inputVariants({zSize: 'default'}))).toContain('h-11');
    expect(tokens(inputVariants({zSize: 'lg'}))).toContain('h-12');
  });

  it('does not leave lg shorter than the default size', () => {
    const lg = tokens(inputVariants({zSize: 'lg'}));

    expect(lg).not.toContain('h-10');
    expect(lg).not.toContain('h-11');
  });
});
