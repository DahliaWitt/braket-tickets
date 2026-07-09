import {cva, type VariantProps} from 'class-variance-authority';

export const dropdownContentVariants = cva(
  'z-50 min-w-50 overflow-y-auto rounded-md border bg-popover px-1 py-1 text-popover-foreground shadow-md',
);

export const dropdownItemVariants = cva(
  'relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors outline-none select-none hover:bg-primary/10 hover:text-foreground focus:bg-primary/10 focus:text-foreground focus-visible:bg-primary/10 focus-visible:text-foreground data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-primary/10 data-highlighted:text-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: '',
        destructive:
          'text-destructive-text hover:bg-destructive/10 hover:text-destructive-text focus:bg-destructive/10 focus:text-destructive-text dark:hover:bg-destructive/20 dark:focus:bg-destructive/20',
      },
      inset: {
        true: 'pl-8',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'default',
      inset: false,
    },
  },
);

export type BraDropdownItemVariants = VariantProps<typeof dropdownItemVariants>;
