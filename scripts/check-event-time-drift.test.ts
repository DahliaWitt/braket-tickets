// @vitest-environment node

import {describe, expect, it} from 'vitest';
import {findMatches, shouldScan} from './check-event-time-drift';

function findingNames(source: string): string[] {
  return findMatches('frontend/src/app/example.component.ts', source).map(
    (finding) => finding.name,
  );
}

describe('check-event-time-drift', () => {
  it('flags raw Angular date pipes on event dates', () => {
    expect(
      findingNames(`template: "{{ event.date | date: 'mediumDate' }}"`),
    ).toContain('raw-angular-date-pipe');
  });

  it('flags browser-local event date locale formatting', () => {
    expect(
      findingNames(
        `const label = new Date(event.date).toLocaleDateString('en-US');`,
      ),
    ).toContain('raw-event-date-locale-format');
  });

  it('flags raw event date instant parsing', () => {
    expect(
      findingNames(`const startsAt = new Date(event.date).getTime();`),
    ).toContain('raw-event-date-instant-parse');
    expect(findingNames(`const startsAt = Date.parse(event.date);`)).toContain(
      'raw-event-date-instant-parse',
    );
  });

  it('flags the same drift patterns on event end dates', () => {
    expect(
      findingNames(`template: "{{ event.endDate | date: 'shortTime' }}"`),
    ).toContain('raw-angular-date-pipe');
    expect(
      findingNames(
        `const label = new Date(event.endDate).toLocaleTimeString('en-US');`,
      ),
    ).toContain('raw-event-date-locale-format');
    expect(findingNames(`const key = event.endDate.slice(0, 10);`)).toContain(
      'raw-event-date-key-extraction',
    );
  });

  it('flags ISO slicing from event dates', () => {
    expect(findingNames(`const key = event.date.slice(0, 10);`)).toContain(
      'raw-event-date-key-extraction',
    );
    expect(
      findingNames(`const key = args.event.date.split('T')[0];`),
    ).toContain('raw-event-date-key-extraction');
  });

  it('flags formatDate on event dates', () => {
    expect(
      findingNames(
        `const label = formatDate(event.date, 'fullDate', 'en-US');`,
      ),
    ).toContain('raw-event-date-format-date');
  });

  it('flags DatePipe service transforms on event dates', () => {
    expect(
      findingNames(
        `const label = this.datePipe.transform(event.date, 'mediumDate');`,
      ),
    ).toContain('raw-event-date-date-pipe-transform');
    expect(
      findingNames(
        `const label = datePipe.transform(selectedEvent.date, 'mediumDate');`,
      ),
    ).toContain('raw-event-date-date-pipe-transform');
  });

  it('flags hardcoded platform timezone formatter options', () => {
    expect(
      findingNames(
        `const formatter = new Intl.DateTimeFormat('en-US', {timeZone: 'America/Los_Angeles'});`,
      ),
    ).toContain('hardcoded-event-time-zone');
  });

  it('allows shared event-time helpers and non-event dates', () => {
    expect(
      findingNames(`
        const key = formatEventDateKey(event.date);
        const startsAt = eventStartInstantMs(event.date);
        const label = formatEventDate(event.date, 'mediumDate');
        const submitted = submittedAt | date: 'short';
      `),
    ).toEqual([]);
  });

  it('scans source files but not tests or generated output', () => {
    expect(shouldScan('frontend/src/app/example.component.ts')).toBe(true);
    expect(shouldScan('frontend/src/app/example.component.html')).toBe(true);
    expect(shouldScan('frontend/src/app/example.component.spec.ts')).toBe(
      false,
    );
    expect(shouldScan('backend/convex/_generated/api.d.ts')).toBe(false);
  });
});
