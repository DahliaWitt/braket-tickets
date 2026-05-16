import {env} from '../_generated/server';

export type BearerTokenPurpose =
  | 'admin_invite'
  | 'magic_link'
  | 'guest_session'
  | 'marketing_unsubscribe_user'
  | 'marketing_unsubscribe_address'
  | 'marketing_tracking_open'
  | 'marketing_tracking_click';

const DIGEST_VERSION = 'v1';
const TOKEN_BYTE_LENGTH = 32;
const TOKEN_PREFIX_LENGTH = 8;

function getDigestSecret(): string {
  const secret = env.TOKEN_DIGEST_SECRET;
  if (!secret) {
    throw new Error('TOKEN_DIGEST_SECRET is required for bearer token digests');
  }
  return secret;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

export function generateBearerToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function tokenPrefix(token: string): string {
  return token.slice(0, TOKEN_PREFIX_LENGTH);
}

export async function digestBearerToken(
  purpose: BearerTokenPurpose,
  token: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getDigestSecret()),
    {name: 'HMAC', hash: 'SHA-256'},
    false,
    ['sign'],
  );
  const payload = `braket:${purpose}:${DIGEST_VERSION}:${token}`;
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload),
  );
  return bytesToHex(new Uint8Array(signature));
}
