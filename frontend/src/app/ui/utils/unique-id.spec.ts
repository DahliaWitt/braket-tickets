import {describe, expect, it} from 'vitest';

describe('uniqueComponentId', () => {
  it('starts from zero for a fresh module instance', async () => {
    const {uniqueComponentId} = await import('./unique-id');

    expect(uniqueComponentId('field')).toBe('field-0');
    expect(uniqueComponentId('field')).toBe('field-1');

    vi.resetModules();
    const freshModule = await import('./unique-id');

    expect(freshModule.uniqueComponentId('field')).toBe('field-0');
  });
});
