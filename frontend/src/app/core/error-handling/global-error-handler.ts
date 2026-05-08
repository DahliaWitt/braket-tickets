import { type ErrorHandler, Injectable, inject } from '@angular/core';
import { BraToastService } from '@ui/components/composites/toast/toast.service';
import { logger } from '@/utils/logger';

/** Errors that should not show a toast (handled elsewhere or non-actionable) */
const SUPPRESSED_PATTERNS = [
  'NG0100', // ExpressionChangedAfterItHasBeenCheckedError — dev-mode only
  'NG05105', // Navigation cancelled — user navigated away
  'Loading chunk', // Handled by chunk-error-recovery
];

@Injectable({ providedIn: 'root' })
export class GlobalErrorHandler implements ErrorHandler {
  private toast = inject(BraToastService);

  handleError(error: unknown): void {
    const raw = (error as { rejection?: unknown })?.rejection ?? error;
    const message =
      raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : '';

    // Log detailed error for debugging — always
    logger.error('[GlobalErrorHandler] Caught unhandled error:', error);

    // Suppress non-actionable errors
    if (message && SUPPRESSED_PATTERNS.some((p) => message.includes(p))) {
      return;
    }

    // Show a generic user-friendly toast — never expose raw error text
    this.toast.show({
      message: 'something went wrong — try refreshing the page',
      type: 'error',
      duration: 5000,
    });
  }
}
