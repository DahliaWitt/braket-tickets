import { cva, type VariantProps } from 'class-variance-authority';

export const badgeVariants = cva(
  'inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden',
  {
    variants: {
      zType: {
        default: 'border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        success: 'border-transparent bg-success text-success-foreground',
        warning: 'border-transparent bg-warning text-warning-foreground',
        info: 'border-transparent bg-info text-info-foreground',
        outline: 'text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
      },
      zAppearance: {
        solid: '',
        soft: '',
      },
      zShape: {
        default: 'rounded-md',
        square: 'rounded-none',
        pill: 'rounded-full',
      },
    },
    compoundVariants: [
      { zType: 'success', zAppearance: 'soft', class: 'bg-success/10 text-success border-success/20 border' },
      { zType: 'warning', zAppearance: 'soft', class: 'bg-warning/10 text-warning border-warning/20 border' },
      { zType: 'destructive', zAppearance: 'soft', class: 'bg-destructive/10 text-destructive border-destructive/20 border' },
      { zType: 'default', zAppearance: 'soft', class: 'bg-primary/10 text-primary border-primary/20 border' },
      { zType: 'info', zAppearance: 'soft', class: 'bg-info/10 text-info border-info/20 border' },
      { zType: 'secondary', zAppearance: 'soft', class: 'bg-secondary/10 text-secondary border-secondary/20 border' },
    ],
    defaultVariants: {
      zType: 'default',
      zAppearance: 'solid',
      zShape: 'default',
    },
  },
);
export type ZardBadgeVariants = VariantProps<typeof badgeVariants>;
