/**
 * Injects `<link rel="preconnect">` hints for the Convex backend origins.
 *
 * The Convex URLs are build-time defines (`__BRAKET_RUNTIME__`), so they
 * cannot appear as static hints in `index.html`. Calling this at the top of
 * `main.ts` starts DNS + TCP + TLS for both origins while Angular is still
 * bootstrapping, instead of paying that handshake inside the first
 * Better Auth `getSession()` call that gates initial navigation.
 *
 * Invalid or duplicate origins are skipped; failures are silently ignored
 * because a missing hint only costs the optimization, never correctness.
 */
export function addConvexPreconnects(
  doc: Document,
  urls: readonly string[],
): void {
  const seen = new Set<string>();

  for (const url of urls) {
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      continue;
    }

    if (seen.has(origin) || origin === doc.location?.origin) {
      continue;
    }
    seen.add(origin);

    const link = doc.createElement('link');
    link.rel = 'preconnect';
    link.href = origin;
    doc.head.appendChild(link);
  }
}
