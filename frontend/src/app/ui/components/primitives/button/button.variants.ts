import { cva, type VariantProps } from 'class-variance-authority';

import { mergeClasses } from '@ui/utils/merge-classes';

export const buttonVariants = cva(
  mergeClasses(
    'cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[transform,color,background-color,opacity] active:scale-97',
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0",
    'outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
    'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
  ),
  {
    variants: {
      zType: {
        default: '',
        destructive:
          'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        outline:
          'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        success: 'bg-success text-success-foreground hover:bg-success/90 border-none',
        ghost: 'hover:bg-foreground/10 hover:text-foreground dark:hover:bg-foreground/10',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      zSize: {
        default: 'h-11 px-4 py-2 data-icon-only:size-11 data-icon-only:p-0',
        sm: 'h-9 rounded-md gap-1.5 px-3 data-icon-only:size-9 data-icon-only:p-0',
        lg: 'h-12 rounded-md px-6 data-icon-only:size-12 data-icon-only:p-0',
      },
      zShape: {
        default: 'rounded-md',
        circle: 'rounded-full',
        square: 'rounded-none',
      },
      zFull: {
        true: 'w-full',
      },
      zLoading: {
        true: 'pointer-events-none cursor-wait',
      },
      zDisabled: {
        true: 'pointer-events-none cursor-not-allowed',
      },
      zGlow: {
        true: '',
        false: '',
      },
    },
    compoundVariants: [
      {
        zType: 'default',
        zDisabled: false,
        zLoading: false,
        class:
          'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 dark:bg-primary/90 dark:hover:bg-primary/85 disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none',
      },
      {
        zType: 'default',
        zDisabled: true,
        class:
          'border border-border bg-muted text-muted-foreground shadow-none cursor-not-allowed',
      },
      {
        zType: 'default',
        zLoading: true,
        class:
          'border border-border bg-muted text-muted-foreground shadow-none cursor-wait',
      },
      { zType: 'default', zGlow: true, class: 'font-display uppercase tracking-wider shadow-[0_2px_10px_-2px_hsl(var(--primary)/0.5),0_0_25px_-5px_hsl(var(--primary)/0.15)]' },
      { zType: 'success', zGlow: true, class: 'font-display uppercase tracking-wider shadow-[0_2px_10px_-2px_hsl(var(--success)/0.5),0_0_25px_-5px_hsl(var(--success)/0.15)]' },
      { zType: 'destructive', zGlow: true, class: 'font-display uppercase tracking-wider shadow-[0_2px_10px_-2px_hsl(var(--destructive)/0.5),0_0_25px_-5px_hsl(var(--destructive)/0.15)]' },
      { zType: 'secondary', zGlow: true, class: 'font-display uppercase tracking-wider shadow-[0_2px_10px_-2px_hsl(var(--secondary)/0.5),0_0_25px_-5px_hsl(var(--secondary)/0.15)]' },
    ],
    defaultVariants: {
      zType: 'default',
      zSize: 'default',
      zShape: 'default',
    },
  },
);
export type ZardButtonShapeVariants = NonNullable<VariantProps<typeof buttonVariants>['zShape']>;
export type ZardButtonSizeVariants = NonNullable<VariantProps<typeof buttonVariants>['zSize']>;
export type ZardButtonTypeVariants = NonNullable<VariantProps<typeof buttonVariants>['zType']>;
