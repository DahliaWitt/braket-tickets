import {cva, type VariantProps} from 'class-variance-authority';

export const tooltipVariants = cva(
  'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit rounded-md bg-foreground px-3 py-1.5 text-xs text-balance text-background',
);

export const tooltipPositionVariants = cva('absolute', {
  variants: {
    position: {
      top: 'bottom-0 left-[calc(50%-5px)] translate-y-full',
      bottom: '-top-2.5 left-[calc(50%-5px)] translate-y-0 rotate-180',
      left: 'top-[calc(50%-5px)] -right-2.5 translate-y-0 rotate-270',
      right: 'top-[calc(50%-5px)] -left-2.5 translate-y-0 rotate-90',
    },
  },
});

export type ZardTooltipPositionVariants = NonNullable<
  VariantProps<typeof tooltipPositionVariants>['position']
>;
