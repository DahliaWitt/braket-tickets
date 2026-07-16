export type SocialProvider = 'google' | 'discord';
export type AuthProviderId = SocialProvider | 'credential';

// Record keys force a compile error here when SocialProvider gains a member,
// so the guard below cannot silently lag behind the union.
const SOCIAL_PROVIDER_FLAGS: Record<SocialProvider, true> = {
  google: true,
  discord: true,
};

export const SOCIAL_PROVIDER_IDS = Object.keys(
  SOCIAL_PROVIDER_FLAGS,
) as readonly SocialProvider[];

export const AUTH_PROVIDER_IDS = ['google', 'discord', 'credential'] as const;

export function isAuthProviderId(value: string): value is AuthProviderId {
  return AUTH_PROVIDER_IDS.includes(value as AuthProviderId);
}

export function isSocialProvider(
  value: string | undefined,
): value is SocialProvider {
  return SOCIAL_PROVIDER_IDS.includes(value as SocialProvider);
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
  {provider: 'google', displayName: 'Google'},
  {provider: 'discord', displayName: 'Discord'},
];
