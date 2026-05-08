import {cva} from 'class-variance-authority';

export const sliderVariants = cva(
  'relative flex w-full touch-none items-center select-none py-3 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col data-[orientation=vertical]:py-0 data-[orientation=vertical]:px-3',
  {
    variants: {
      orientation: {
        horizontal: 'items-center',
        vertical: 'flex-col h-full min-h-44 w-auto',
      },
      disabled: {
        true: 'opacity-50 pointer-events-none',
        false: '',
      },
    },
    defaultVariants: {
      orientation: 'horizontal',
      disabled: false,
    },
  },
);

export const sliderTrackVariants = cva(
  'flex bg-muted relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5',
  {
    variants: {
      zOrientation: {
        horizontal: 'h-1.5 w-full',
        vertical: 'w-1.5 h-full min-h-44',
      },
    },
    defaultVariants: {
      zOrientation: 'horizontal',
    },
  },
);

export const sliderRangeVariants = cva(
  'bg-primary absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full',
  {
    variants: {
      zOrientation: {
        horizontal: 'h-full',
        vertical: 'w-full',
      },
    },
    defaultVariants: {
      zOrientation: 'horizontal',
    },
  },
);

export const sliderThumbVariants = cva(
  'border-primary bg-background ring-ring/50 block size-4 shrink-0 rounded-full border shadow-sm transition-[color,box-shadow] focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      disabled: {
        true: '',
        false: 'hover:ring-4',
      },
    },
  },
);

export const sliderOrientationVariants = cva('absolute', {
  variants: {
    zOrientation: {
      horizontal: 'translate-x-[-50%]',
      vertical: 'translate-y-[50%]',
    },
  },
  defaultVariants: {
    zOrientation: 'horizontal',
  },
});
