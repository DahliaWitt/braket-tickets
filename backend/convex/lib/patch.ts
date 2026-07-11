/**
 * Helpers for building Convex `ctx.db.patch` objects that support clearing an
 * optional field.
 *
 * Convex clients cannot express "remove this field" by omitting it: an omitted
 * key means "leave unchanged", and a key whose value is `undefined` is silently
 * dropped as it crosses the mutation argument boundary (see the
 * `debugging_convex_patch_undefined` note). The wire-safe way to let a client
 * request a clear is an explicit `null` sentinel on the argument, translated
 * *inside the mutation* into a `{field: undefined}` key on the object passed
 * straight to `ctx.db.patch` — only then does Convex remove the field.
 *
 * `applyClearableField` centralizes that translation so every write path that
 * exposes a clearable optional field behaves identically.
 */
export function applyClearableField<Obj extends object, K extends keyof Obj>(
  patch: Obj,
  key: K,
  value: Obj[K] | null | undefined,
  currentValue: Obj[K] | undefined,
): void {
  if (value === undefined) {
    // Field omitted by the caller — leave the stored value untouched.
    return;
  }
  if (value === null) {
    // Explicit clear. Skip when the field is already absent so we don't add a
    // no-op key to the patch. Otherwise set `undefined`, which `ctx.db.patch`
    // removes from the document. This object must be handed directly to
    // `ctx.db.patch`; `undefined` keys do not survive a function-arg boundary.
    if (currentValue === undefined) return;
    (patch as Record<PropertyKey, unknown>)[key as PropertyKey] = undefined;
    return;
  }
  patch[key] = value;
}
