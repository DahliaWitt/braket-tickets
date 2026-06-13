import {Pipe, type PipeTransform} from '@angular/core';
import {formatEventDate} from './event-date-format';

@Pipe({
  name: 'eventDate',
  standalone: true,
})
export class EventDatePipe implements PipeTransform {
  transform(
    value: string | number | Date | null | undefined,
    format = 'mediumDate',
  ): string {
    return formatEventDate(value, format) ?? '';
  }
}
