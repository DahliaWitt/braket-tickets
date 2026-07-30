/**
 * @vitest-environment node
 */
import {describe, it, expect} from 'vitest';
import {ConvexError} from 'convex/values';
import {
  appErrorData,
  ErrorCodes,
  ErrorMessages,
  throwAppError,
  throwUnauthenticated,
  throwUnauthorized,
  throwForbidden,
  throwAdminOnly,
  throwNotFound,
  throwInvalidInput,
  throwInvalidState,
  throwConflict,
  getAppErrorMessage,
  getAppErrorCode,
} from './errors';

describe('appErrorData', () => {
  it('builds canonical structured ConvexError data', () => {
    expect(appErrorData('INVALID_STATE', 'Cannot continue')).toEqual({
      code: 'INVALID_STATE',
      message: 'Cannot continue',
    });
  });

  it('keeps code and message authoritative when details are supplied', () => {
    expect(
      appErrorData('INVALID_STATE', 'Cannot continue', {
        code: 'OTHER',
        message: 'Other message',
        retryAfterMs: 1000,
      }),
    ).toEqual({
      code: 'INVALID_STATE',
      message: 'Cannot continue',
      retryAfterMs: 1000,
    });
  });
});

describe('throwAppError', () => {
  it('throws a ConvexError with structured code and message data', () => {
    try {
      throwAppError('INVALID_INPUT', 'Email is invalid', {field: 'email'});
      throw new Error('Expected throwAppError to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ConvexError);
      expect(
        (e as ConvexError<{code: string; message: string; field: string}>).data,
      ).toEqual({
        code: 'INVALID_INPUT',
        message: 'Email is invalid',
        field: 'email',
      });
    }
  });
});

describe('throwUnauthenticated', () => {
  it('throws structured UNAUTHENTICATED data', () => {
    try {
      throwUnauthenticated();
      throw new Error('Expected throwUnauthenticated to throw');
    } catch (e) {
      expect((e as ConvexError<{code: string; message: string}>).data).toEqual({
        code: ErrorCodes.UNAUTHENTICATED,
        message: ErrorMessages.UNAUTHENTICATED,
      });
    }
  });
});

describe('throwUnauthorized', () => {
  it('throws structured FORBIDDEN data', () => {
    try {
      throwUnauthorized();
      throw new Error('Expected throwUnauthorized to throw');
    } catch (e) {
      expect((e as ConvexError<{code: string; message: string}>).data).toEqual({
        code: ErrorCodes.FORBIDDEN,
        message: ErrorMessages.UNAUTHORIZED,
      });
    }
  });
});

describe('throwAdminOnly', () => {
  it('throws structured FORBIDDEN data', () => {
    try {
      throwAdminOnly();
      throw new Error('Expected throwAdminOnly to throw');
    } catch (e) {
      expect((e as ConvexError<{code: string; message: string}>).data).toEqual({
        code: ErrorCodes.FORBIDDEN,
        message: ErrorMessages.ADMIN_ONLY,
      });
    }
  });
});

describe('throwForbidden', () => {
  it('throws structured FORBIDDEN data with a custom message', () => {
    try {
      throwForbidden('Only the ticket owner can do this');
      throw new Error('Expected throwForbidden to throw');
    } catch (e) {
      expect((e as ConvexError<{code: string; message: string}>).data).toEqual({
        code: ErrorCodes.FORBIDDEN,
        message: 'Only the ticket owner can do this',
      });
    }
  });
});

describe('throwNotFound', () => {
  it('throws structured NOT_FOUND data with the resource name', () => {
    try {
      throwNotFound('Ticket');
    } catch (e) {
      expect((e as Error).message).toContain('Ticket not found');
      expect(
        (e as ConvexError<{code: string; message: string; resource: string}>)
          .data,
      ).toEqual({
        code: ErrorCodes.NOT_FOUND,
        message: 'Ticket not found',
        resource: 'Ticket',
      });
    }
  });
});

describe('domain helpers', () => {
  it('throws structured INVALID_INPUT data', () => {
    try {
      throwInvalidInput('Name is required', {field: 'name'});
      throw new Error('Expected throwInvalidInput to throw');
    } catch (e) {
      expect(
        (e as ConvexError<{code: string; message: string; field: string}>).data,
      ).toEqual({
        code: ErrorCodes.INVALID_INPUT,
        message: 'Name is required',
        field: 'name',
      });
    }
  });

  it('throws structured INVALID_STATE data', () => {
    try {
      throwInvalidState('Order cannot be refunded');
      throw new Error('Expected throwInvalidState to throw');
    } catch (e) {
      expect((e as ConvexError<{code: string; message: string}>).data).toEqual({
        code: ErrorCodes.INVALID_STATE,
        message: 'Order cannot be refunded',
      });
    }
  });

  it('throws structured CONFLICT data', () => {
    try {
      throwConflict('Ticket is already listed');
      throw new Error('Expected throwConflict to throw');
    } catch (e) {
      expect((e as ConvexError<{code: string; message: string}>).data).toEqual({
        code: ErrorCodes.CONFLICT,
        message: 'Ticket is already listed',
      });
    }
  });
});

describe('getAppErrorMessage', () => {
  it('extracts structured ConvexError messages', () => {
    const error = new ConvexError({
      code: 'INVALID_INPUT',
      message: 'Subject is required',
    });

    expect(getAppErrorMessage(error)).toBe('Subject is required');
  });

  it('extracts legacy string ConvexError messages', () => {
    expect(getAppErrorMessage(new ConvexError('legacy message'))).toBe(
      'legacy message',
    );
  });

  it('extracts normal Error messages', () => {
    expect(getAppErrorMessage(new Error('plain error'))).toBe('plain error');
  });

  it('returns null when there is no message', () => {
    expect(getAppErrorMessage({})).toBeNull();
  });
});

describe('getAppErrorCode', () => {
  it('extracts the structured code from a ConvexError payload', () => {
    const error = new ConvexError(
      appErrorData('INVALID_INPUT', 'Subject is required'),
    );
    expect(getAppErrorCode(error)).toBe('INVALID_INPUT');
  });

  it('returns null for legacy string ConvexError data', () => {
    expect(getAppErrorCode(new ConvexError('legacy message'))).toBeNull();
  });

  it('returns null for a ConvexError without a string code', () => {
    expect(
      getAppErrorCode(new ConvexError({message: 'no code here'})),
    ).toBeNull();
  });

  it('returns null for non-Convex errors', () => {
    expect(getAppErrorCode(new Error('plain error'))).toBeNull();
    expect(getAppErrorCode({code: 'X'})).toBeNull();
    expect(getAppErrorCode(null)).toBeNull();
  });
});
