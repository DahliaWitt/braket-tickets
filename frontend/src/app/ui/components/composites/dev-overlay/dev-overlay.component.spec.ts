import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DevOverlayComponent } from './dev-overlay.component';

describe('DevOverlayComponent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('treats server rendering as non-local', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'server' }],
    });

    const component = TestBed.runInInjectionContext(() => new DevOverlayComponent());

    expect(() => component.isLocal()).not.toThrow();
    expect(component.isLocal()).toBe(false);
  });
});
