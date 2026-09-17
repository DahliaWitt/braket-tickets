import type {Doc} from '../../_generated/dataModel';
import {throwAppError} from '../errors';
import {hasEventEnded} from '../timezone';

export function isGuestListEventActive(event: Doc<'events'>): boolean {
  return event.status !== 'cancelled' && !hasEventEnded(event);
}

export function requireGuestListEventActive(event: Doc<'events'>): void {
  if (event.status === 'cancelled') {
    throwAppError(
      'INVALID_STATE',
      'Guest-list assignments are unavailable for a cancelled event',
    );
  }
  if (hasEventEnded(event)) {
    throwAppError(
      'INVALID_STATE',
      'Guest-list assignments are unavailable because the event has ended',
    );
  }
}
