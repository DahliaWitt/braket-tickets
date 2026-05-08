function hasTargetProperty<T extends string>(
  target: EventTarget | null,
  property: T,
): target is EventTarget & Record<T, unknown> {
  return !!target && typeof target === 'object' && property in target;
}

/**
 * Reads a string `value` from a DOM event target.
 * Returns null when the target is missing or does not expose a string value.
 */
export function readInputValue(target: EventTarget | null): string | null {
  if (!hasTargetProperty(target, 'value')) {
    return null;
  }

  return typeof target.value === 'string' ? target.value : null;
}

/**
 * Reads a boolean `checked` state from a DOM event target.
 * Returns null when the target is missing or does not expose a boolean value.
 */
export function readInputChecked(target: EventTarget | null): boolean | null {
  if (!hasTargetProperty(target, 'checked')) {
    return null;
  }

  return typeof target.checked === 'boolean' ? target.checked : null;
}
