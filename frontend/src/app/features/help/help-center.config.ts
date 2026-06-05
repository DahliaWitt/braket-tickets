declare const __HELP_CENTER_ENABLED__: boolean;

export const HELP_CENTER_ENABLED =
  typeof __HELP_CENTER_ENABLED__ === 'undefined'
    ? false
    : __HELP_CENTER_ENABLED__;
