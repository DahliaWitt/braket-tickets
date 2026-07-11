import {cva, type VariantProps} from 'class-variance-authority';

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
      pill: 'rounded-md bg-muted p-1',
    },
  },
  defaultVariants: {
    zStyle: 'underline',
  },
});

export const tabVariants = cva(
  'inline-flex cursor-pointer items-center justify-center font-display text-sm tracking-wider whitespace-nowrap uppercase transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
  {
    variants: {
      zStyle: {
        underline: '-mb-px border-b-2 pb-2',
        pill: 'rounded-sm px-3 py-1.5',
      },
      active: {
        true: '',
        false: '',
      },
    },
    compoundVariants: [
      {
        zStyle: 'underline',
        active: true,
        class: 'border-primary text-foreground',
      },
      {
        zStyle: 'underline',
        active: false,
        class: 'border-transparent text-muted-foreground hover:text-foreground',
      },
      {
        zStyle: 'pill',
        active: true,
        class: 'bg-background text-foreground shadow-xs',
      },
      {
        zStyle: 'pill',
        active: false,
        class: 'text-muted-foreground hover:text-foreground',
      },
    ],
    defaultVariants: {
      zStyle: 'underline',
      active: false,
    },
  },
);

export type ZardTabStyleVariants = NonNullable<
  VariantProps<typeof tabGroupVariants>['zStyle']
>;
