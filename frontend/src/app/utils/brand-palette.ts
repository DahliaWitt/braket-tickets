/**
 * Brand-accurate hex colors for use across external SDKs.
 *
 * jsPDF cannot consume CSS variables, and Stripe/ApexCharts require hex values,
 * so these are the hex equivalents of the Pulp theme's semantic tokens and
 * SDK-specific contrast-safe roles. Values are derived from the `@layer base`
 * theme blocks in styles.css.
 *
 * Light token derivations (HSL → hex):
 *   --primary              335 90% 45%   →  #da0b62
 *   --background           0   0% 98%   →  #fafafa
 *   --card                 0   0% 97%   →  #f7f7f7
 *   --foreground           320 10%  8%  →  #161215
 *   --muted-foreground     320 10% 25%  →  #463942
 *   --muted                320  5% 93%  →  #eeeced
 *   --border               320  6% 82%  →  #d4ced2
 *   --destructive          0  84% 42%     → #c51111
 *   --success              160 84% 22%  →  #096748
 *
 * Not mirrored here (no SDK consumes them yet — add on first use):
 *   --accent-text (light)  25  80% 32%  →  #934710
 *   --accent-text (dark)   25  80% 60%  →  #eb8b47
 */
// LINT.IfChange
export const BRAND_THEME_PALETTE = {
  light: {
    primary: '#da0b62',
    foreground: '#161215',
    background: '#fafafa',
    card: '#f7f7f7',
    mutedForeground: '#463942',
    muted: '#eeeced',
    border: '#d4ced2',
    destructive: '#c51111',
    destructiveTint: '#fef2f2',
    success: '#096748',
    white: '#ffffff',
  },
  dark: {
    primary: '#f31672',
    primaryButton: '#de1467',
    foreground: '#f5f5f5',
    background: '#0c090b',
    card: '#110d10',
    mutedForeground: '#aba0a8',
    muted: '#2f282d',
    border: '#372f34',
    destructive: '#7f1d1d',
    destructiveText: '#f37272',
    white: '#ffffff',
  },
} as const;
// LINT.ThenChange("../../styles.css")

const LIGHT = BRAND_THEME_PALETTE.light;
const DARK = BRAND_THEME_PALETTE.dark;

export const BRAND_PALETTE = {
  /** Deep Crimson-Wine — replaces all former neon pink (#ff0080) usage. */
  primary: LIGHT.primary,
  /** Near-black with plum undertone — document/heading text on white. */
  foreground: LIGHT.foreground,
  /** Light page background — table fills, info boxes. */
  background: LIGHT.background,
  /** Muted warm-plum — secondary text, footers, subtitles. */
  mutedForeground: LIGHT.mutedForeground,
  /** Very light plum-tinted gray — alternating row fills, info panels. */
  muted: LIGHT.muted,
  /** Soft warm border — table grid lines, dividers. */
  border: LIGHT.border,
  /** Destructive red — error states, refund headers. */
  destructive: LIGHT.destructive,
  /** Very light red tint — alternating rows in refund tables. */
  destructiveTint: LIGHT.destructiveTint,
  /** Darkened forest green — success states. */
  success: LIGHT.success,
  /** Mid-gray — table body text (active rows). */
  tableBodyText: '#374151',
  /** Slightly lighter gray — fee/secondary table body text. */
  tableMutedText: '#4b5563',
  /** Muted italic gray — refunded/void row text. */
  tableRefundedText: '#6b7280',
  /** Pure white — foreground on primary/destructive header fills. */
  white: LIGHT.white,
} as const;

export const STRIPE_CONNECT_APPEARANCE_PALETTE = {
  light: {
    colorPrimary: LIGHT.primary,
    colorBackground: LIGHT.card,
    colorText: LIGHT.foreground,
    colorSecondaryText: LIGHT.mutedForeground,
    colorDanger: LIGHT.destructive,
    buttonPrimaryColorBackground: LIGHT.primary,
    buttonPrimaryColorBorder: LIGHT.primary,
    buttonPrimaryColorText: LIGHT.white,
    buttonSecondaryColorBackground: LIGHT.background,
    buttonSecondaryColorBorder: LIGHT.border,
    buttonSecondaryColorText: LIGHT.foreground,
    buttonDangerColorBackground: LIGHT.destructive,
    buttonDangerColorBorder: LIGHT.destructive,
    buttonDangerColorText: LIGHT.white,
    actionPrimaryColorText: LIGHT.primary,
    actionPrimaryTextDecorationColor: LIGHT.primary,
    actionSecondaryColorText: LIGHT.mutedForeground,
    actionSecondaryTextDecorationColor: LIGHT.mutedForeground,
    badgeNeutralColorBackground: LIGHT.muted,
    badgeNeutralColorText: LIGHT.mutedForeground,
    badgeNeutralColorBorder: LIGHT.border,
    badgeSuccessColorBackground: '#e7f7f1',
    badgeSuccessColorText: '#096748',
    badgeSuccessColorBorder: '#8fd1ba',
    badgeWarningColorBackground: '#fff4db',
    badgeWarningColorText: '#7f5305',
    badgeWarningColorBorder: '#e6bd6f',
    badgeDangerColorBackground: LIGHT.destructiveTint,
    badgeDangerColorText: LIGHT.destructive,
    badgeDangerColorBorder: '#ee9a9a',
    offsetBackgroundColor: LIGHT.muted,
    formBackgroundColor: LIGHT.background,
    colorBorder: LIGHT.border,
    formHighlightColorBorder: LIGHT.primary,
    formAccentColor: LIGHT.primary,
    formPlaceholderTextColor: LIGHT.mutedForeground,
    overlayBackdropColor: 'rgba(22, 18, 21, 0.55)',
  },
  dark: {
    colorPrimary: DARK.primary,
    colorBackground: DARK.card,
    colorText: DARK.foreground,
    colorSecondaryText: DARK.mutedForeground,
    colorDanger: DARK.destructiveText,
    buttonPrimaryColorBackground: DARK.primaryButton,
    buttonPrimaryColorBorder: DARK.primaryButton,
    buttonPrimaryColorText: DARK.white,
    buttonSecondaryColorBackground: DARK.muted,
    buttonSecondaryColorBorder: DARK.border,
    buttonSecondaryColorText: DARK.foreground,
    buttonDangerColorBackground: DARK.destructive,
    buttonDangerColorBorder: DARK.destructive,
    buttonDangerColorText: DARK.white,
    actionPrimaryColorText: DARK.primary,
    actionPrimaryTextDecorationColor: DARK.primary,
    actionSecondaryColorText: DARK.mutedForeground,
    actionSecondaryTextDecorationColor: DARK.mutedForeground,
    badgeNeutralColorBackground: DARK.muted,
    badgeNeutralColorText: DARK.mutedForeground,
    badgeNeutralColorBorder: DARK.border,
    badgeSuccessColorBackground: '#0d2e24',
    badgeSuccessColorText: '#20c58e',
    badgeSuccessColorBorder: '#166f54',
    badgeWarningColorBackground: '#3a2910',
    badgeWarningColorText: '#ebaf47',
    badgeWarningColorBorder: '#8a6120',
    badgeDangerColorBackground: '#3a1118',
    badgeDangerColorText: '#f46b7d',
    badgeDangerColorBorder: '#8f2331',
    offsetBackgroundColor: DARK.muted,
    formBackgroundColor: DARK.background,
    colorBorder: DARK.border,
    formHighlightColorBorder: DARK.primary,
    formAccentColor: DARK.primary,
    formPlaceholderTextColor: DARK.mutedForeground,
    overlayBackdropColor: 'rgba(12, 9, 11, 0.72)',
  },
} as const;
