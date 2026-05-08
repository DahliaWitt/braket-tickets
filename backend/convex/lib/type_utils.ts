/**
 * Bidirectional type-equality check. Tuple wrapping disables distribution
 * over unions so `AssertEqual<'a' | 'b', 'a'>` is correctly `false`.
 *
 * Usage:
 *   const _check: AssertEqual<Infer<typeof validator>, SharedUnion> = true;
 */
export type AssertEqual<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;
