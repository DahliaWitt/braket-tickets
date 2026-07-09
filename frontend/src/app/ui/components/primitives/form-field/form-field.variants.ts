import {cva, type VariantProps} from 'class-variance-authority';

export const formFieldVariants = cva('grid gap-2');

export const formLabelVariants = cva(
  'mono-label text-xs leading-none text-muted-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
  {
    variants: {
      zRequired: {
        true: "after:ml-0.5 after:text-destructive-text after:content-['*']",
      },
    },
  },
);

export const formMessageVariants = cva('mono-label text-2xs', {
  variants: {
    zType: {
      default: 'text-muted-foreground',
      error: 'text-destructive-text',
      success: 'text-success',
      warning: 'text-warning',
    },
  },
  defaultVariants: {
    zType: 'default',
  },
});

export type ZardFormMessageTypeVariants = NonNullable<
  VariantProps<typeof formMessageVariants>['zType']
>;
