import {
  makeEnvironmentProviders,
  type EnvironmentProviders,
  inject,
  provideAppInitializer,
} from '@angular/core';
import { EVENT_MANAGER_PLUGINS } from '@angular/platform-browser';

import { BraDebounceEventManagerPlugin } from './event-manager-plugins/bra-debounce-event-manager-plugin';
import { BraEventManagerPlugin } from './event-manager-plugins/bra-event-manager-plugin';
import { BraDarkMode } from '../../services/dark-mode';

export function provideBra(): EnvironmentProviders {
  const eventManagerPlugins = [
    {
      provide: EVENT_MANAGER_PLUGINS,
      useClass: BraEventManagerPlugin,
      multi: true,
    },
    {
      provide: EVENT_MANAGER_PLUGINS,
      useClass: BraDebounceEventManagerPlugin,
      multi: true,
    },
  ];

  return makeEnvironmentProviders([
    provideAppInitializer(() => {
      inject(BraDarkMode);
    }),
    ...eventManagerPlugins,
  ]);
}
