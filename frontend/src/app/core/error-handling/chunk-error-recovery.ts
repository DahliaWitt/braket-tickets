import {type ErrorHandler} from '@angular/core';
import type {BrowserPlatformService} from '@/core/services/browser-platform.service';
import {extractErrorMessage} from '@/core/utils/error-message.utils';

const RELOAD_KEY = 'bt-chunk-reload';
const COOLDOWN_MS = 10_000;

/**
 * Detects chunk-load errors from stale bundles after deploys.
 * Matches the standard browser error messages for failed dynamic imports.
 */
export function isChunkLoadError(error: unknown): boolean {
  const message = extractErrorMessage(error);
  return (
    message.includes('Importing a module script failed') ||
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('Loading chunk')
  );
}

/**
 * Attempts a page reload with a sessionStorage cooldown guard.
 * Returns true if reload was initiated, false if cooldown is active.
 */
function attemptReload(browser: BrowserPlatformService): boolean {
  const last = browser.getSessionStorageItem(RELOAD_KEY);
  const now = Date.now();
  if (!last || now - parseInt(last, 10) > COOLDOWN_MS) {
    if (!browser.setSessionStorageItem(RELOAD_KEY, now.toString())) {
      return false;
    }
    browser.reload();
    return true;
  }
  return false;
}

/**
 * Wraps an ErrorHandler with chunk-load error recovery.
 *
 * When a stale-chunk error is detected, reloads the page to fetch fresh
 * bundles. A 10-second cooldown prevents infinite reload loops.
 * Non-chunk errors pass through to the inner handler unchanged.
 *
 * Fixes COMMUNITY-14: TypeError on lazy routes after Cloudflare Pages deploys.
 */
export function withChunkErrorRecovery(
  inner: ErrorHandler,
  browser: BrowserPlatformService,
): ErrorHandler {
  return {
    handleError(error: unknown): void {
      if (isChunkLoadError(error) && attemptReload(browser)) {
        return;
      }
      inner.handleError(error);
    },
  };
}
