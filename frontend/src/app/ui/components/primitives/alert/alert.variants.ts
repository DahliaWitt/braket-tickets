import {cva, type VariantProps} from 'class-variance-authority';

export const alertVariants = cva(
  'relative flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-sm',
  {
    variants: {
      zType: {
        default: 'bg-card text-card-foreground',
        success: 'text-success',
        warning: 'text-warning',
        error: 'text-destructive-text',
        info: 'text-info-text',
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
        class: 'border-transparent bg-muted',
      },
      {
        zType: 'default',
        zAppearance: 'fill',
        class: 'border-transparent bg-foreground text-background',
      },
      {
        zType: 'success',
        zAppearance: 'outline',
        class: 'border-success/30 bg-card',
      },
      {
        zType: 'success',
        zAppearance: 'soft',
        class: 'border-transparent bg-success/10',
      },
      {
        zType: 'success',
        zAppearance: 'fill',
        class: 'border-transparent bg-success text-success-foreground',
      },
      {
        zType: 'warning',
        zAppearance: 'outline',
        class: 'border-warning/30 bg-card',
      },
      {
        zType: 'warning',
        zAppearance: 'soft',
        class: 'border-transparent bg-warning/10',
      },
      {
        zType: 'warning',
        zAppearance: 'fill',
        class: 'border-transparent bg-warning text-warning-foreground',
      },
      {
        zType: 'error',
        zAppearance: 'outline',
        class: 'border-destructive/30 bg-card',
      },
      {
        zType: 'error',
        zAppearance: 'soft',
        class: 'border-transparent bg-destructive/10',
      },
      {
        zType: 'error',
        zAppearance: 'fill',
        class: 'border-transparent bg-destructive text-destructive-foreground',
      },
      {zType: 'info', zAppearance: 'outline', class: 'border-info/30 bg-card'},
      {
        zType: 'info',
        zAppearance: 'soft',
        class: 'border-transparent bg-info/10',
      },
      {
        zType: 'info',
        zAppearance: 'fill',
        class: 'border-transparent bg-info text-info-foreground',
      },
    ],
    defaultVariants: {
      zType: 'default',
      zAppearance: 'outline',
    },
  },
);

export const alertDescriptionVariants = cva(
  'mt-1 text-sm leading-relaxed [&:first-child]:mt-0',
  {
    variants: {
      zType: {
        default: 'text-muted-foreground',
        success: 'text-success/90',
        warning: 'text-warning/90',
        error: 'text-destructive-text/90',
        info: 'text-info-text/90',
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
