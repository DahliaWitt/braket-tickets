import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {type ErrorHandler} from '@angular/core';
import {isChunkLoadError, withChunkErrorRecovery} from './chunk-error-recovery';
import type {BrowserPlatformService} from '@/core/services/browser-platform.service';

describe('chunk-error-recovery', () => {
  describe('isChunkLoadError', () => {
    describe('returns true for chunk-load error messages', () => {
      it('detects TypeError with "Importing a module script failed"', () => {
        const error = new TypeError('Importing a module script failed.');
        expect(isChunkLoadError(error)).toBe(true);
      });

      it('detects Error with "Loading chunk" prefix', () => {
        const error = new Error('Loading chunk abc123 failed.');
        expect(isChunkLoadError(error)).toBe(true);
      });

      it('detects Error with "Failed to fetch dynamically imported module"', () => {
        const error = new Error(
          'Failed to fetch dynamically imported module https://example.com/chunk-abc.js',
        );
        expect(isChunkLoadError(error)).toBe(true);
      });

      it('detects Safari MIME errors when stale chunk URLs return the SPA shell', () => {
        const error = new TypeError(
          "'text/html' is not a valid JavaScript MIME type.",
        );
        expect(isChunkLoadError(error)).toBe(true);
      });
    });

    describe('handles non-Error object shapes', () => {
      it('detects plain object with message property', () => {
        const error = {
          message: 'Failed to fetch dynamically imported module',
        };
        expect(isChunkLoadError(error)).toBe(true);
      });

      it('detects Angular-wrapped rejection with nested TypeError', () => {
        const error = {
          rejection: new TypeError('Importing a module script failed.'),
        };
        expect(isChunkLoadError(error)).toBe(true);
      });

      it('detects bare string containing chunk-load message', () => {
        expect(isChunkLoadError('Importing a module script failed')).toBe(true);
      });
    });

    describe('returns false for non-chunk errors', () => {
      it('rejects unrelated Error', () => {
        expect(isChunkLoadError(new Error('Something else'))).toBe(false);
      });

      it('rejects null', () => {
        expect(isChunkLoadError(null)).toBe(false);
      });

      it('rejects undefined', () => {
        expect(isChunkLoadError(undefined)).toBe(false);
      });

      it('rejects numeric value', () => {
        expect(isChunkLoadError(42)).toBe(false);
      });

      it('rejects empty object', () => {
        expect(isChunkLoadError({})).toBe(false);
      });

      it('rejects object with non-string message', () => {
        expect(isChunkLoadError({message: 123})).toBe(false);
      });
    });
  });

  describe('withChunkErrorRecovery', () => {
    let innerHandler: ErrorHandler;
    let reloadSpy: ReturnType<typeof vi.fn>;
    let browser: Pick<
      BrowserPlatformService,
      'getSessionStorageItem' | 'setSessionStorageItem' | 'reload'
    >;

    beforeEach(() => {
      innerHandler = {handleError: vi.fn()} satisfies ErrorHandler;
      reloadSpy = vi.fn();
      browser = {
        getSessionStorageItem: vi.fn(() => null),
        setSessionStorageItem: vi.fn(() => true),
        reload: reloadSpy as unknown as () => void,
      };
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns an ErrorHandler with a handleError method', () => {
      const handler = withChunkErrorRecovery(
        innerHandler,
        browser as BrowserPlatformService,
      );
      expect(handler).toBeDefined();
      expect(typeof handler.handleError).toBe('function');
    });

    describe('on chunk-load error', () => {
      it('requests a browser reload', () => {
        const handler = withChunkErrorRecovery(
          innerHandler,
          browser as BrowserPlatformService,
        );
        handler.handleError(new TypeError('Importing a module script failed.'));
        expect(reloadSpy).toHaveBeenCalledOnce();
      });

      it('does not call inner handler', () => {
        const handler = withChunkErrorRecovery(
          innerHandler,
          browser as BrowserPlatformService,
        );
        handler.handleError(new TypeError('Importing a module script failed.'));
        expect(innerHandler.handleError).not.toHaveBeenCalled();
      });

      it('stores reload timestamp through the browser boundary', () => {
        const handler = withChunkErrorRecovery(
          innerHandler,
          browser as BrowserPlatformService,
        );
        handler.handleError(new Error('Loading chunk xyz failed.'));
        expect(browser.setSessionStorageItem).toHaveBeenCalledWith(
          'bt-chunk-reload',
          expect.any(String),
        );
        const stored =
          vi.mocked(browser.setSessionStorageItem).mock.calls[0]?.[1] ?? '';
        const ts = parseInt(stored, 10);
        expect(Math.abs(Date.now() - ts)).toBeLessThan(1000);
      });
    });

    describe('on non-chunk error', () => {
      it('calls inner handler with the error', () => {
        const handler = withChunkErrorRecovery(
          innerHandler,
          browser as BrowserPlatformService,
        );
        const error = new Error('ReferenceError: x is not defined');
        handler.handleError(error);
        expect(innerHandler.handleError).toHaveBeenCalledWith(error);
      });

      it('does not reload the page', () => {
        const handler = withChunkErrorRecovery(
          innerHandler,
          browser as BrowserPlatformService,
        );
        handler.handleError(new Error('something broke'));
        expect(reloadSpy).not.toHaveBeenCalled();
      });
    });

    describe('cooldown guard', () => {
      it('falls through to inner handler if reload was recent (within 10s)', () => {
        vi.mocked(browser.getSessionStorageItem).mockReturnValue(
          Date.now().toString(),
        );

        const handler = withChunkErrorRecovery(
          innerHandler,
          browser as BrowserPlatformService,
        );
        const chunkError = new TypeError('Importing a module script failed.');
        handler.handleError(chunkError);

        expect(reloadSpy).not.toHaveBeenCalled();
        expect(innerHandler.handleError).toHaveBeenCalledWith(chunkError);
      });

      it('reloads if previous reload was more than 10 seconds ago', () => {
        vi.mocked(browser.getSessionStorageItem).mockReturnValue(
          (Date.now() - 15_000).toString(),
        );

        const handler = withChunkErrorRecovery(
          innerHandler,
          browser as BrowserPlatformService,
        );
        handler.handleError(
          new Error(
            'Failed to fetch dynamically imported module /chunk-abc.js',
          ),
        );

        expect(reloadSpy).toHaveBeenCalledOnce();
        expect(innerHandler.handleError).not.toHaveBeenCalled();
      });

      it('reloads if sessionStorage key is absent (first occurrence)', () => {
        const handler = withChunkErrorRecovery(
          innerHandler,
          browser as BrowserPlatformService,
        );
        handler.handleError(new Error('Loading chunk main failed.'));

        expect(reloadSpy).toHaveBeenCalledOnce();
        expect(innerHandler.handleError).not.toHaveBeenCalled();
      });

      it('falls through if the cooldown marker cannot be persisted', () => {
        vi.mocked(browser.setSessionStorageItem).mockReturnValue(false);

        const handler = withChunkErrorRecovery(
          innerHandler,
          browser as BrowserPlatformService,
        );
        const chunkError = new TypeError('Importing a module script failed.');
        handler.handleError(chunkError);

        expect(reloadSpy).not.toHaveBeenCalled();
        expect(innerHandler.handleError).toHaveBeenCalledWith(chunkError);
      });
    });
  });
});
