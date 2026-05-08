import {cva} from 'class-variance-authority';

export const calendarVariants = cva(
  'bg-popover p-3 w-fit rounded-lg border border-border text-popover-foreground',
);

export const calendarNavVariants = cva(
  'flex items-center justify-between gap-2 w-fit mb-4',
);

export const calendarWeekdayVariants = cva(
  'text-muted-foreground font-mono font-normal uppercase tracking-widest text-center text-[0.7rem] w-8',
);

export const calendarDayVariants = cva(
  'p-0 relative focus-within:relative focus-within:z-20 flex mt-1 h-8 w-8 text-sm',
);

export const calendarDayButtonVariants = cva(
  'p-0 font-mono font-normal flex items-center justify-center whitespace-nowrap rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:pointer-events-none disabled:opacity-40 hover:bg-primary/10 hover:text-foreground w-full h-full text-sm',
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
        true: 'text-muted-foreground opacity-50 cursor-not-allowed',
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
