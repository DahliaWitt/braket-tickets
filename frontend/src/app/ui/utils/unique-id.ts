let counter = 0;

/**
 * Returns a stable, monotonically increasing ID for use in component templates.
 */
export function uniqueComponentId(prefix: string): string {
  return `${prefix}-${counter++}`;
}
