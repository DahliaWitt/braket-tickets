import {
  SocialAuthBlockedError,
  type AuthService,
  type SocialAuthCompletionState,
} from '@/core/services/auth.service';

export interface ConfirmOAuthCallbackResult {
  completionState: SocialAuthCompletionState;
}

export type ConfirmOAuthCallbackOutcome =
  | {ok: true; result: ConfirmOAuthCallbackResult}
  | {ok: false; errorMessage: string};

export async function resolveConfirmOAuthCallback(options: {
  auth: AuthService;
  callbackError: string | undefined;
  ott: string | undefined;
  callbackErrorMessage: string;
  missingOttMessage: string;
  fallbackErrorMessage: string;
}): Promise<ConfirmOAuthCallbackOutcome> {
  if (options.callbackError) {
    return {ok: false, errorMessage: options.callbackErrorMessage};
  }

  if (!options.ott) {
    return {ok: false, errorMessage: options.missingOttMessage};
  }

  try {
    const completionState = await options.auth.handleOAuthCallback(
      options.ott,
      {navigateOnSuccess: false},
    );
    return {ok: true, result: {completionState}};
  } catch (err: unknown) {
    return {
      ok: false,
      errorMessage:
        err instanceof SocialAuthBlockedError
          ? err.message
          : options.fallbackErrorMessage,
    };
  }
}
