import {vi, type Mock} from 'vitest';

interface NullableResponse<T> {
  data: T | null;
  error: Error | {message?: string} | null;
}

export interface MockAuthClient {
  signIn: {
    email: Mock;
    social: Mock;
  };
  signUp: {
    email: Mock;
  };
  verifyEmail: Mock;
  signOut: Mock;
  getSession: Mock<() => Promise<NullableResponse<unknown>>>;
  $fetch: Mock;
  convex: {
    token: Mock<() => Promise<NullableResponse<{token: string}>>>;
  };
  requestPasswordReset: Mock;
  resetPassword: Mock;
  sendVerificationEmail: Mock;
}

export function createMockAuthClient(): MockAuthClient {
  const client: MockAuthClient = {
    signIn: {
      email: vi.fn(),
      social: vi.fn(),
    },
    signUp: {
      email: vi.fn(),
    },
    verifyEmail: vi.fn(),
    signOut: vi.fn(),
    getSession: vi.fn(),
    $fetch: vi.fn(),
    convex: {
      token: vi.fn(),
    },
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    sendVerificationEmail: vi.fn(),
  };

  resetMockAuthClient(client);
  return client;
}

export function resetMockAuthClient(client: MockAuthClient): void {
  client.signIn.email.mockReset().mockResolvedValue({data: null, error: null});
  client.signIn.social.mockReset().mockResolvedValue({data: null, error: null});
  client.signUp.email.mockReset().mockResolvedValue({data: null, error: null});
  client.verifyEmail.mockReset().mockResolvedValue({data: null, error: null});
  client.signOut.mockReset().mockResolvedValue(undefined);
  client.getSession.mockReset().mockResolvedValue({data: null, error: null});
  client.$fetch.mockReset().mockResolvedValue(undefined);
  client.convex.token.mockReset().mockResolvedValue({data: null, error: null});
  client.requestPasswordReset.mockReset().mockResolvedValue({error: null});
  client.resetPassword.mockReset().mockResolvedValue({error: null});
  client.sendVerificationEmail.mockReset().mockResolvedValue({error: null});
}

export const sharedMockAuthClient = createMockAuthClient();
