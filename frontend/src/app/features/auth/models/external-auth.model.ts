export type SocialProvider = 'google' | 'discord';
export type AuthProviderId = SocialProvider | 'credential';

export const AUTH_PROVIDER_IDS = ['google', 'discord', 'credential'] as const;

export function isAuthProviderId(value: string): value is AuthProviderId {
  return AUTH_PROVIDER_IDS.includes(value as AuthProviderId);
}

export interface ExternalAuth {
  id: string;
  provider: AuthProviderId;
  providerId: string;
  providerEmail?: string;
  isEmailVerified?: boolean;
  created?: string;
  updated?: string;
}

export interface ConnectedProviderRow {
  provider: SocialProvider;
  displayName: string;
}

export interface ProviderStatus {
  provider: SocialProvider;
  state: 'linked' | 'unlinked' | 'unavailable' | 'error';
  providerId?: string;
  connectedEmail?: string;
  emailVerified?: boolean;
  unavailable?: boolean;
}

export const CONNECTED_PROVIDERS: ConnectedProviderRow[] = [
  { provider: 'google', displayName: 'Google' },
  { provider: 'discord', displayName: 'Discord' },
];
