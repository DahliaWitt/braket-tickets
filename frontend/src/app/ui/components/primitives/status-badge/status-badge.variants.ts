import {cva, type VariantProps} from 'class-variance-authority';

export const statusBadgeVariants = cva(
  'mono-label inline-flex items-center border px-2 py-0.5',
  {
    variants: {
      status: {
        success: 'border-success/20 bg-success/10 text-success',
        warning: 'border-warning/20 bg-warning/10 text-warning',
        destructive: 'border-destructive/20 bg-destructive/10 text-destructive',
        info: 'border-info/20 bg-info/10 text-info',
        muted: 'border-border bg-muted text-muted-foreground',
        primary: 'border-primary/20 bg-primary/10 text-primary',
        secondary: 'border-secondary/20 bg-secondary/10 text-secondary',
        accent: 'border-accent/20 bg-accent/10 text-accent',
      },
      size: {
        sm: 'px-2 py-0.5 text-2xs',
        md: 'px-2.5 py-1 text-xs',
      },
      shape: {
        rounded: 'rounded',
        pill: 'rounded-full',
      },
    },
    defaultVariants: {status: 'muted', size: 'sm', shape: 'rounded'},
  },
);

export type BraStatusBadgeVariants = VariantProps<typeof statusBadgeVariants>;
