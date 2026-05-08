import {cva, type VariantProps} from 'class-variance-authority';

export const alertVariants = cva(
  'relative w-full rounded-lg border px-4 py-3 text-sm flex items-start gap-3',
  {
    variants: {
      zType: {
        default: 'bg-card text-card-foreground',
        success: 'text-success',
        warning: 'text-warning',
        error: 'text-destructive',
        info: 'text-info',
      },
      zAppearance: {
        outline: '',
        soft: '',
        fill: '',
      },
    },
    compoundVariants: [
      {zType: 'default', zAppearance: 'outline', class: 'border-border'},
      {
        zType: 'default',
        zAppearance: 'soft',
        class: 'bg-muted border-transparent',
      },
      {
        zType: 'default',
        zAppearance: 'fill',
        class: 'bg-foreground text-background border-transparent',
      },
      {
        zType: 'success',
        zAppearance: 'outline',
        class: 'border-success/30 bg-card',
      },
      {
        zType: 'success',
        zAppearance: 'soft',
        class: 'bg-success/10 border-transparent',
      },
      {
        zType: 'success',
        zAppearance: 'fill',
        class: 'bg-success text-success-foreground border-transparent',
      },
      {
        zType: 'warning',
        zAppearance: 'outline',
        class: 'border-warning/30 bg-card',
      },
      {
        zType: 'warning',
        zAppearance: 'soft',
        class: 'bg-warning/10 border-transparent',
      },
      {
        zType: 'warning',
        zAppearance: 'fill',
        class: 'bg-warning text-warning-foreground border-transparent',
      },
      {
        zType: 'error',
        zAppearance: 'outline',
        class: 'border-destructive/30 bg-card',
      },
      {
        zType: 'error',
        zAppearance: 'soft',
        class: 'bg-destructive/10 border-transparent',
      },
      {
        zType: 'error',
        zAppearance: 'fill',
        class: 'bg-destructive text-destructive-foreground border-transparent',
      },
      {zType: 'info', zAppearance: 'outline', class: 'border-info/30 bg-card'},
      {
        zType: 'info',
        zAppearance: 'soft',
        class: 'bg-info/10 border-transparent',
      },
      {
        zType: 'info',
        zAppearance: 'fill',
        class: 'bg-info text-info-foreground border-transparent',
      },
    ],
    defaultVariants: {
      zType: 'default',
      zAppearance: 'outline',
    },
  },
);

export const alertDescriptionVariants = cva(
  'text-sm leading-relaxed mt-1 [&:first-child]:mt-0',
  {
    variants: {
      zType: {
        default: 'text-muted-foreground',
        success: 'text-success/90',
        warning: 'text-warning/90',
        error: 'text-destructive/90',
        info: 'text-info/90',
      },
    },
    defaultVariants: {
      zType: 'default',
    },
  },
);

export type ZardAlertTypeVariants = NonNullable<
  VariantProps<typeof alertVariants>['zType']
>;
export type ZardAlertAppearanceVariants = NonNullable<
  VariantProps<typeof alertVariants>['zAppearance']
>;
