import {cva} from 'class-variance-authority';

import {mergeClasses} from '@ui/utils/merge-classes';

export const cardVariants = cva(
  'bg-card text-card-foreground flex gap-6 rounded-xl border shadow-sm min-w-0 min-h-0 overflow-hidden',
  {
    variants: {
      zVariant: {
        default: 'flex-col py-6',
        horizontal: 'flex-row py-0',
      },
    },
    defaultVariants: {
      zVariant: 'default',
    },
  },
);

export const cardHeaderVariants = cva(
  mergeClasses(
    '@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 min-w-0',
    'has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6',
  ),
);

export const cardBodyVariants = cva('px-6 flex-1 flex flex-col min-h-0');

export const cardFooterVariants = cva(
  'flex flex-col gap-2 items-center px-6 [.border-t]:pt-6',
);
