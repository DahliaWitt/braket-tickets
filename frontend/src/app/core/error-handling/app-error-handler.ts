import {type ErrorHandler, inject, Injectable} from '@angular/core';
import {environment} from '../../../environments/environment';
import {handleSentryError, isSentryEnabled} from '../services/sentry-loader';
import {GlobalErrorHandler} from './global-error-handler';
import {logger} from '@/utils/logger';

@Injectable({providedIn: 'root'})
export class AppErrorHandler implements ErrorHandler {
  private readonly globalErrorHandler = inject(GlobalErrorHandler);

  handleError(error: unknown): void {
    if (!isSentryEnabled(environment)) {
      this.globalErrorHandler.handleError(error);
      return;
    }

    logger.error('[AppErrorHandler] Caught unhandled error:', error);
    void handleSentryError(error, environment).then((handledBySentry) => {
      if (!handledBySentry) {
        this.globalErrorHandler.handleError(error);
      }
    });
  }
}
