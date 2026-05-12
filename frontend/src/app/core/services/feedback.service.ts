import {Injectable} from '@angular/core';
import {environment} from '../../../environments/environment';
import {openSentryFeedback} from './sentry-loader';

@Injectable({
  providedIn: 'root',
})
export class FeedbackService {
  open(): Promise<boolean> {
    return openSentryFeedback(environment);
  }
}
