import {cva, type VariantProps} from 'class-variance-authority';

import {mergeClasses} from '@ui/utils/merge-classes';

export const selectVariants = cva(
  'group relative inline-block w-full rounded-md data-active:border data-active:border-ring data-active:ring-[3px] data-active:ring-ring/50',
);

export const selectTriggerVariants = cva(
  mergeClasses(
    'flex w-full items-center justify-between gap-2 rounded-md border border-input bg-background',
    'cursor-pointer shadow-xs transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50',
    'text-foreground hover:border-ring hover:bg-primary/5',
    'data-placeholder:text-muted-foreground [&_svg:not([class*="text-"])]:text-muted-foreground',
    'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
    'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
  ),
  {
    variants: {
      zSize: {
        sm: 'min-h-8 px-2 py-1 text-xs',
        default: 'min-h-11 px-4 py-2 text-base',
        lg: 'min-h-12 px-4 py-2.5 text-base',
      },
    },
    defaultVariants: {
      zSize: 'default',
    },
  },
);
export const selectContentVariants = cva(
  'scrollbar-hide animate-in fade-in-0 zoom-in-95 z-9999 min-w-full overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-lg backdrop-blur-md',
);
export const selectItemVariants = cva(
  'relative mb-0.5 flex min-w-full cursor-pointer items-center gap-2 rounded-sm text-nowrap outline-hidden select-none hover:bg-primary/10 hover:text-foreground data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:hover:bg-transparent data-disabled:hover:text-current data-selected:bg-primary data-selected:text-primary-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4 [&_svg:not([class*="text-"])]:text-muted-foreground',
  {
    variants: {
      zSize: {
        sm: 'min-h-8 py-1 text-xs',
        default: 'min-h-9 py-1.5 text-sm',
        lg: 'min-h-10 py-2 text-base',
      },
      zMode: {
        normal: 'pr-8 pl-2',
        compact: 'pr-2 pl-6.5',
      },
    },
    compoundVariants: [
      {
        zMode: 'compact',
        zSize: 'sm',
        class: 'pr-2 pl-5',
      },
    ],
  },
);

export const selectItemIconVariants = cva(
  'absolute flex size-3.5 items-center justify-center',
  {
    variants: {
      // zSize variants are placeholders for compound variant matching
      zSize: {
        sm: '',
        default: '',
        lg: '',
      },
      zMode: {
        normal: 'right-2',
        compact: 'left-2',
      },
    },
    compoundVariants: [
      {
        zMode: 'compact',
        zSize: 'sm',
        class: 'left-1',
      },
    ],
  },
);

export type ZardSelectSizeVariants = NonNullable<
  VariantProps<typeof selectTriggerVariants>['zSize']
>;
export type ZardSelectItemModeVariants = NonNullable<
  VariantProps<typeof selectItemVariants>['zMode']
>;
