import { cva, type VariantProps } from 'class-variance-authority';

export const statusBadgeVariants = cva(
  'mono-label inline-flex items-center border px-2 py-0.5',
  {
    variants: {
      status: {
        success: 'bg-success/10 text-success border-success/20',
        warning: 'bg-warning/10 text-warning border-warning/20',
        destructive: 'bg-destructive/10 text-destructive border-destructive/20',
        info: 'bg-info/10 text-info border-info/20',
        muted: 'bg-muted text-muted-foreground border-border',
        primary: 'bg-primary/10 text-primary border-primary/20',
        secondary: 'bg-secondary/10 text-secondary border-secondary/20',
      },
      size: {
        sm: 'text-2xs py-0.5 px-2',
        md: 'text-xs py-1 px-2.5',
      },
      shape: {
        rounded: 'rounded',
        pill: 'rounded-full',
      },
    },
    defaultVariants: { status: 'muted', size: 'sm', shape: 'rounded' },
  },
);

export type BraStatusBadgeVariants = VariantProps<typeof statusBadgeVariants>;
