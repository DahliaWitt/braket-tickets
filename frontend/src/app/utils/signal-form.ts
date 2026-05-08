import { validate, requiredError } from '@angular/forms/signals';
import type { MaybeFieldTree, PathKind, SchemaPath, SchemaPathRules } from '@angular/forms/signals';

interface SignalFormFieldState {
  invalid(): boolean;
  touched(): boolean;
  dirty(): boolean;
  errors(): readonly { kind: string }[];
}

function isCallableField(field: unknown): field is () => SignalFormFieldState {
  return typeof field === 'function';
}

export function isSignalFormFieldInvalid(
  field: unknown,
  submitted = false,
  options: { includeDirty?: boolean } = {},
): boolean {
  if (!isCallableField(field)) return false;

  const state = field();
  const isDirty = options.includeDirty ? state.dirty() : false;
  return state.invalid() && (state.touched() || isDirty || submitted);
}

export function signalFormFieldHasError(field: unknown, errorKind: string): boolean {
  if (!isCallableField(field)) return false;

  const expected = errorKind.toLowerCase();
  return field()
    .errors()
    .some((error) => error.kind.toLowerCase() === expected);
}

export function castSignalFormField<T>(
  field: MaybeFieldTree<unknown> | null | undefined,
): MaybeFieldTree<T> | null {
  return field ? (field as MaybeFieldTree<T>) : null;
}

/**
 * Rejects string values that are non-empty but contain only whitespace.
 * Use alongside `required` so both empty and whitespace-only values surface
 * as a 'required' error. Skips validation for non-string values.
 */
export function notBlank<TPathKind extends PathKind>(
  path: SchemaPath<string, SchemaPathRules.Supported, TPathKind>,
): void {
  validate(path, (ctx) => {
    const value = ctx.value();
    if (typeof value === 'string' && value.length > 0 && value.trim().length === 0) {
      return requiredError();
    }
    return undefined;
  });
}
