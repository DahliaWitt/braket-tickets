import {cva, type VariantProps} from 'class-variance-authority';

export const inputVariants = cva('w-full text-foreground', {
  variants: {
    zType: {
      default:
        'flex rounded-md border border-input bg-transparent px-4 font-normal outline-hidden file:border-0 file:bg-transparent file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
      textarea:
        'flex h-auto min-h-20 rounded-md border border-input bg-background px-3 py-2 pb-2 text-base outline-hidden placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
    },
    zSize: {
      default: 'text-base',
      sm: 'text-xs',
      lg: 'text-base',
    },
    zStatus: {
      error: 'border-destructive focus-visible:ring-destructive',
      warning: 'border-warning focus-visible:ring-warning',
      success: 'border-success focus-visible:ring-success',
    },
    zBorderless: {
      true: 'flex-1 border-0 bg-transparent px-0 py-0 outline-hidden focus-visible:ring-0 focus-visible:ring-offset-0',
    },
  },
  defaultVariants: {
    zType: 'default',
    zSize: 'default',
  },
  compoundVariants: [
    {zType: 'default', zSize: 'default', class: 'h-11 py-2 file:max-md:py-0'},
    {
      zType: 'default',
      zSize: 'sm',
      class: 'h-8 file:max-md:py-1.5 file:md:py-2',
    },
    {
      zType: 'default',
      zSize: 'lg',
      class: 'h-12 py-2 file:max-md:py-2.5 file:md:py-3',
    },
  ],
});

export type ZardInputTypeVariants = NonNullable<
  VariantProps<typeof inputVariants>['zType']
>;
export type ZardInputSizeVariants = NonNullable<
  VariantProps<typeof inputVariants>['zSize']
>;
export type ZardInputStatusVariants = NonNullable<
  VariantProps<typeof inputVariants>['zStatus']
>;
