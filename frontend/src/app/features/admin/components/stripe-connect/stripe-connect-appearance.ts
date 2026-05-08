import type {AppearanceOptions, AppearanceVariables} from '@stripe/connect-js';
import {STRIPE_CONNECT_APPEARANCE_PALETTE} from '@/utils/brand-palette';
import {EDarkModes} from '@ui/services/dark-mode';

const COMMON_APPEARANCE_VARIABLES = {
  fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  fontSizeBase: '16px',
  spacingUnit: '8px',
  borderRadius: '4px',
  buttonBorderRadius: '4px',
  formBorderRadius: '4px',
  badgeBorderRadius: '4px',
  overlayBorderRadius: '4px',
  buttonLabelFontWeight: '600',
  headingLgFontWeight: '700',
  headingMdFontWeight: '700',
  labelMdFontWeight: '600',
  labelSmFontWeight: '600',
} satisfies AppearanceVariables;

const APPEARANCE_VARIABLES_BY_THEME = {
  [EDarkModes.LIGHT]: {
    ...COMMON_APPEARANCE_VARIABLES,
    ...STRIPE_CONNECT_APPEARANCE_PALETTE.light,
  },
  [EDarkModes.DARK]: {
    ...COMMON_APPEARANCE_VARIABLES,
    ...STRIPE_CONNECT_APPEARANCE_PALETTE.dark,
  },
} satisfies Record<EDarkModes.LIGHT | EDarkModes.DARK, AppearanceVariables>;

export function buildStripeConnectAppearance(
  themeMode: EDarkModes,
): AppearanceOptions {
  const variables =
    themeMode === EDarkModes.DARK
      ? APPEARANCE_VARIABLES_BY_THEME[EDarkModes.DARK]
      : APPEARANCE_VARIABLES_BY_THEME[EDarkModes.LIGHT];

  return {
    overlays: 'dialog',
    variables: {...variables},
  };
}
