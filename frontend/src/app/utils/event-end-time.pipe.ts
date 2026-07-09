import {Pipe, type PipeTransform} from '@angular/core';
import {formatEventEndTimeSuffix} from './event-date-format';

/**
 * Renders an event's end as a suffix for the start time, timezone-aware:
 * `{{ evt.date | eventDate: 'shortTime' }}{{ evt.endDate | eventEndTime: evt.date }}`
 * → "10:00 PM – 6:00 AM" (overnight ends include the end day). Emits ''
 * when no valid end exists, so it is safe to append unconditionally.
 */
@Pipe({
  name: 'eventEndTime',
  standalone: true,
})
export class EventEndTimePipe implements PipeTransform {
  transform(
    endDate: string | null | undefined,
    startDate: string | number | Date | null | undefined,
  ): string {
    return formatEventEndTimeSuffix(endDate, startDate);
  }
}
