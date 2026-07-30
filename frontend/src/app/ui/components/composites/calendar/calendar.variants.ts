import {cva} from 'class-variance-authority';

export const calendarVariants = cva(
  'w-fit rounded-lg border border-border bg-popover p-3 text-popover-foreground',
);

export const calendarNavVariants = cva(
  'mb-4 flex w-fit items-center justify-between gap-2',
);

export const calendarWeekdayVariants = cva(
  'w-8 text-center font-mono text-[0.7rem] font-normal tracking-widest text-muted-foreground uppercase',
);

export const calendarDayVariants = cva(
  'relative mt-1 flex h-8 w-8 p-0 text-sm focus-within:relative focus-within:z-20',
);

export const calendarDayButtonVariants = cva(
  'flex h-full w-full cursor-pointer items-center justify-center rounded-md p-0 font-mono text-sm font-normal whitespace-nowrap transition-colors hover:bg-primary/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      selected: {
        true: 'bg-primary text-primary-foreground hover:bg-primary/90',
        false: '',
      },
      today: {
        true: 'ring-1 ring-primary/30',
        false: '',
      },
      outside: {
        true: 'text-muted-foreground opacity-60',
        false: '',
      },
      disabled: {
        true: 'cursor-not-allowed text-muted-foreground opacity-50',
        false: '',
      },
      rangeStart: {
        true: 'rounded-r-none bg-primary text-primary-foreground',
        false: '',
      },
      rangeEnd: {
        true: 'rounded-l-none bg-primary text-primary-foreground',
        false: '',
      },
      inRange: {
        true: 'rounded-none bg-primary/10 hover:bg-primary/20',
        false: '',
      },
    },
    compoundVariants: [
      {
        today: true,
        selected: false,
        rangeStart: false,
        rangeEnd: false,
        inRange: false,
        className: 'bg-primary/10 text-primary',
      },
      {
        today: true,
        selected: true,
        className: 'bg-primary text-primary-foreground',
      },
      {
        rangeStart: true,
        rangeEnd: true,
        className: 'rounded-md bg-primary text-primary-foreground',
      },
    ],
    defaultVariants: {
      selected: false,
      today: false,
      outside: false,
      disabled: false,
      rangeStart: false,
      rangeEnd: false,
      inRange: false,
    },
  },
);
