import { cva, type VariantProps } from 'class-variance-authority';

export const tabGroupVariants = cva('flex flex-col', {
  variants: {
    zStyle: {
      underline: '',
      pill: '',
    },
  },
  defaultVariants: {
    zStyle: 'underline',
  },
});

export const tabListVariants = cva('flex gap-1', {
  variants: {
    zStyle: {
      underline: 'border-b border-border',
      pill: 'bg-muted rounded-md p-1',
    },
  },
  defaultVariants: {
    zStyle: 'underline',
  },
});

export const tabVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap text-sm font-display uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  {
    variants: {
      zStyle: {
        underline: 'pb-2 border-b-2 -mb-px',
        pill: 'rounded-sm px-3 py-1.5',
      },
      active: {
        true: '',
        false: '',
      },
    },
    compoundVariants: [
      { zStyle: 'underline', active: true, class: 'text-foreground border-primary' },
      { zStyle: 'underline', active: false, class: 'text-muted-foreground border-transparent hover:text-foreground' },
      { zStyle: 'pill', active: true, class: 'bg-background text-foreground shadow-xs' },
      { zStyle: 'pill', active: false, class: 'text-muted-foreground hover:text-foreground' },
    ],
    defaultVariants: {
      zStyle: 'underline',
      active: false,
    },
  },
);

export type ZardTabStyleVariants = NonNullable<VariantProps<typeof tabGroupVariants>['zStyle']>;
