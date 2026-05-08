import { InjectionToken } from '@angular/core';
import { authClient } from '../../../lib/auth.client';

export type AuthClient = typeof authClient;

export const AUTH_CLIENT = new InjectionToken<AuthClient>('AUTH_CLIENT', {
  providedIn: 'root',
  factory: () => authClient,
});
