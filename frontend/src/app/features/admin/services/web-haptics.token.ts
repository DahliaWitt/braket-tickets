import { InjectionToken } from '@angular/core';
import { WebHaptics } from 'web-haptics';

export type WebHapticsCtor = typeof WebHaptics;

export const WEB_HAPTICS_CTOR = new InjectionToken<WebHapticsCtor>('WEB_HAPTICS_CTOR', {
  providedIn: 'root',
  factory: () => WebHaptics,
});
