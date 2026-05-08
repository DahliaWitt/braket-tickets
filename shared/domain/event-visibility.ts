export const EVENT_VISIBILITIES = [
  'private',
  'public_viewable',
  'public',
] as const;

export type EventVisibility = typeof EVENT_VISIBILITIES[number];

/**
 * Named value accessors so callers can write `EVENT_VISIBILITY.PUBLIC`
 * instead of the bare `'public'` string literal. Self-documents intent at
 * comparison sites (e.g. `e.visibility === EVENT_VISIBILITY.PUBLIC`).
 *
 * Values are hardcoded (not positional lookups into `EVENT_VISIBILITIES`)
 * so reordering or removing entries in the source array surfaces a
 * compile error here instead of silently remapping keys. The
 * `satisfies Record<string, EventVisibility>` clause enforces that every
 * value stays a valid `EventVisibility` member.
 */
export const EVENT_VISIBILITY = {
  PRIVATE: 'private',
  PUBLIC_VIEWABLE: 'public_viewable',
  PUBLIC: 'public',
} as const satisfies Record<string, EventVisibility>;
