import {cva} from 'class-variance-authority';

export const alertDialogVariants = cva(
  'fixed z-50 max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] rounded-lg border bg-background shadow-lg sm:max-w-lg',
);
