import {cva, type VariantProps} from 'class-variance-authority';

const shapeVariants = {
  rounded: 'rounded-sm',
  circle: 'rounded-full',
  'rounded-lg': 'rounded-lg',
} as const;

export const communityAvatarContainerVariants = cva(
  'flex-shrink-0 overflow-hidden',
  {
    variants: {
      size: {
        xs: 'h-5 w-5',
        sm: 'h-6 w-6',
        md: 'h-8 w-8',
        lg: 'h-10 w-10',
        xl: 'h-14 w-14',
        '2xl': 'h-16 w-16',
      },
      shape: shapeVariants,
    },
    defaultVariants: {size: 'md', shape: 'rounded'},
  },
);

export const communityAvatarInitialVariants = cva('font-display font-bold', {
  variants: {
    size: {
      xs: 'text-2xs',
      sm: 'text-xs',
      md: 'text-sm',
      lg: 'text-base',
      xl: 'text-2xl',
      '2xl': 'text-2xl tracking-[0.08em]',
    },
  },
  defaultVariants: {size: 'md'},
});

export type BraCommunityAvatarVariants = VariantProps<
  typeof communityAvatarContainerVariants
>;
