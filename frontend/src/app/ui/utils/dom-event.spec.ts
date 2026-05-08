import { describe, expect, it } from 'vitest';

import { readInputChecked, readInputValue } from './dom-event';

describe('dom-event utilities', () => {
  it('returns null for missing or non-input targets', () => {
    expect(readInputValue(null)).toBeNull();
    expect(readInputValue(document.createElement('div'))).toBeNull();
    expect(readInputChecked(null)).toBeNull();
    expect(readInputChecked(document.createElement('div'))).toBeNull();
  });

  it('reads string values from inputs and textareas', () => {
    const input = document.createElement('input');
    input.value = 'hello';

    const textarea = document.createElement('textarea');
    textarea.value = 'world';

    expect(readInputValue(input)).toBe('hello');
    expect(readInputValue(textarea)).toBe('world');
  });

  it('reads checkbox checked state', () => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;

    expect(readInputChecked(checkbox)).toBe(true);
  });
});
