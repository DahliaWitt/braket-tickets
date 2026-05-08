import { ApplicationInitStatus, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EVENT_MANAGER_PLUGINS } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';

import { BraDarkMode } from '../../services/dark-mode';
import { BraDebounceEventManagerPlugin } from './event-manager-plugins/bra-debounce-event-manager-plugin';
import { BraEventManagerPlugin } from './event-manager-plugins/bra-event-manager-plugin';
import { provideBra } from './provide-bra';

describe('provideBra', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('registers custom event manager plugins', () => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideBra(),
        { provide: BraDarkMode, useValue: {} as BraDarkMode },
      ],
    });

    const plugins = TestBed.inject(EVENT_MANAGER_PLUGINS);
    expect(plugins.some((plugin) => plugin instanceof BraEventManagerPlugin)).toBe(true);
    expect(plugins.some((plugin) => plugin instanceof BraDebounceEventManagerPlugin)).toBe(true);
  });

  it('runs app initializer that injects BraDarkMode', async () => {
    let darkModeInjections = 0;

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideBra(),
        {
          provide: BraDarkMode,
          useFactory: () => {
            darkModeInjections += 1;
            return {} as BraDarkMode;
          },
        },
      ],
    });

    const initStatus = TestBed.inject(ApplicationInitStatus);
    await initStatus.donePromise;

    expect(darkModeInjections).toBe(1);
  });
});
