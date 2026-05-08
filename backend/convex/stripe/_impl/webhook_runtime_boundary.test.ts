import {describe, expect, it} from 'vitest';
// Vite `?raw` imports resolve to the file's string contents at build time,
// so these run in any vitest environment including `edge-runtime`.
import stripeNodeSource from '../../lib/stripe_node.ts?raw';
import webhookDispatchSource from './webhook_dispatch.ts?raw';

/**
 * Belt-and-suspenders coverage for the Node-runtime boundary.
 *
 * Convex treats the first-line `'use node';` directive as the sole signal
 * that a module should run in the Node runtime instead of the Convex V8
 * runtime. Strip it off either of these files and:
 *   - `stripe_node.ts`: Stripe SDK import starts pulling Node core modules
 *     the V8 runtime can't resolve, and deploys fail with cryptic errors.
 *   - `webhook_dispatch.ts`: same, transitively through `stripe_node.ts`
 *     and via its own Stripe type imports.
 *
 * The `@convex-dev/import-wrong-runtime` ESLint rule guards the import
 * graph, but the directive itself is invisible to ESLint's AST (it parses
 * as a string literal expression at top-level). This test pins it so a
 * well-meaning "clean up unused string" refactor doesn't silently break
 * production dispatch.
 */

describe('webhook Node-runtime boundary', () => {
  it('lib/stripe_node.ts declares "use node" on its first line', () => {
    const firstLine = stripeNodeSource.split(/\r?\n/)[0]?.trim();
    expect(firstLine).toBe(`'use node';`);
  });

  it('stripe/_impl/webhook_dispatch.ts declares "use node" on its first line', () => {
    const firstLine = webhookDispatchSource.split(/\r?\n/)[0]?.trim();
    expect(firstLine).toBe(`'use node';`);
  });
});
