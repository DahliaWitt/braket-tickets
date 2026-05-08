/**
 * Mock Stripe Connect embed for E2E and unit tests.
 *
 * `@stripe/connect-js` lazily loads a CDN script and registers custom
 * elements (`stripe-connect-*`). In E2E we cannot rely on that CDN and we
 * do not want tests to exercise Stripe-hosted UI inside an iframe — we
 * only care that our Angular wrapper navigates the happy path, mounts
 * the requested components, and hides its skeleton + error states.
 *
 * This helper appends placeholder `<div>` elements with the same
 * `data-testid` values the real SDK branch produces, so the component
 * harness can assert on the same contract either way.
 */
import type {StripeConnectComponentKind} from './stripe-connect-embed.component';

/**
 * Replace the host's children with one `<div data-testid="stripe-connect-${kind}">`
 * per requested component. Matches the real-SDK branch's testid shape so
 * harnesses stay stable across mock vs real paths.
 */
export function mountMockConnectComponents(
  host: HTMLElement,
  kinds: readonly StripeConnectComponentKind[],
): void {
  host.replaceChildren();
  for (const kind of kinds) {
    const el = document.createElement('div');
    el.setAttribute('data-testid', `stripe-connect-${kind}`);
    el.style.padding = '12px';
    el.style.color = 'hsl(var(--muted-foreground))';
    el.style.backgroundColor = 'hsl(var(--card))';
    el.style.border = '1px solid hsl(var(--border))';
    el.style.borderRadius = '4px';
    el.style.fontFamily =
      "var(--font-mono, 'Space Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)";
    el.style.fontSize = '0.625rem';
    el.style.lineHeight = '1rem';
    el.style.textTransform = 'uppercase';
    el.style.letterSpacing = '0.1em';
    el.textContent = `[MOCK] ${kind}`;
    host.appendChild(el);
  }
}
