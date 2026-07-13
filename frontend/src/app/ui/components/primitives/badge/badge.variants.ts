import {cva, type VariantProps} from 'class-variance-authority';

export const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      zType: {
        default:
          'border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90',
        success: 'border-transparent bg-success text-success-foreground',
        warning: 'border-transparent bg-warning text-warning-foreground',
        info: 'border-transparent bg-info text-info-foreground',
        outline:
          'text-foreground [a&]:hover:bg-foreground/10 [a&]:hover:text-foreground',
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
      {
        zType: 'success',
        zAppearance: 'soft',
        class: 'border border-success/20 bg-success/10 text-success',
      },
      {
        zType: 'warning',
        zAppearance: 'soft',
        class: 'border border-warning/20 bg-warning/10 text-warning',
      },
      {
        zType: 'destructive',
        zAppearance: 'soft',
        class:
          'border border-destructive/20 bg-destructive/10 text-destructive-text',
      },
      {
        zType: 'default',
        zAppearance: 'soft',
        class: 'border border-primary/20 bg-primary/10 text-primary',
      },
      {
        zType: 'info',
        zAppearance: 'soft',
        class: 'border border-info/20 bg-info/10 text-info-text',
      },
      {
        zType: 'secondary',
        zAppearance: 'soft',
        class: 'border border-secondary/20 bg-secondary/10 text-secondary-text',
      },
    ],
    defaultVariants: {
      zType: 'default',
      zAppearance: 'solid',
      zShape: 'default',
    },
  },
);
export type ZardBadgeVariants = VariantProps<typeof badgeVariants>;
