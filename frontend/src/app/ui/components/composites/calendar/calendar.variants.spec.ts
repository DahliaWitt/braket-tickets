import {describe, expect, it} from 'vitest';

import {calendarDayButtonVariants} from './calendar.variants';

describe('calendarDayButtonVariants', () => {
  it('uses the primary pink token for interactive hover states', () => {
    const classes = calendarDayButtonVariants();

    expect(classes).toContain('hover:bg-primary/10');
    expect(classes).toContain('hover:text-foreground');
    expect(classes).not.toContain('hover:bg-accent');
  });

  it('uses primary pink for the unselected today chip', () => {
    const classes = calendarDayButtonVariants({
      today: true,
      selected: false,
      rangeStart: false,
      rangeEnd: false,
      inRange: false,
    });

    expect(classes).toContain('ring-primary/30');
    expect(classes).toContain('bg-primary/10');
    expect(classes).toContain('text-primary');
    expect(classes).not.toContain('bg-accent');
    expect(classes).not.toContain('text-success');
  });

  it('keeps selected dates as solid primary', () => {
    const classes = calendarDayButtonVariants({selected: true});

    expect(classes).toContain('bg-primary');
    expect(classes).toContain('text-primary-foreground');
  });

  it('uses primary pink for range fill states', () => {
    const classes = calendarDayButtonVariants({inRange: true});

    expect(classes).toContain('bg-primary/10');
    expect(classes).toContain('hover:bg-primary/20');
    expect(classes).not.toContain('bg-accent');
  });
});
