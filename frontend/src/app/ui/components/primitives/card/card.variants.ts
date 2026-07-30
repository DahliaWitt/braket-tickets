import {cva} from 'class-variance-authority';

import {mergeClasses} from '@ui/utils/merge-classes';

export const cardVariants = cva(
  'flex min-h-0 min-w-0 gap-6 overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm',
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
    '@container/card-header grid min-w-0 auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6',
    'has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6',
  ),
);

export const cardBodyVariants = cva('flex min-h-0 flex-1 flex-col px-6');

export const cardFooterVariants = cva(
  'flex flex-col items-center gap-2 px-6 [.border-t]:pt-6',
);
