---
globs: frontend/e2e/**, frontend/src/**, backend/convex/**, scripts/e2e.ts, scripts/select-affected-e2e.ts, scripts/run-affected-e2e.ts, scripts/e2e-serve.ts, scripts/e2e-run.ts, scripts/lib/ConvexBackend.ts, scripts/lib/AngularFrontend.ts, frontend/scripts/*.ts, frontend/src/types/braket-runtime.d.ts
---

# E2E Testing Rules

## How to Run

Use the /run-e2e skill for executing E2E tests. It handles affected-only runs,
full suite, parallel execution, sharding, and port isolation.

Do NOT run `npx playwright test` directly (bypasses backend harness).
Do NOT run E2E against the remote Convex deployment.

## Iterative E2E (MUST follow)

When fixing or debugging E2E tests, you MUST use the serve/run split to avoid
repeated cold starts (~30s each). Do NOT run `pnpm test:e2e` in a loop.

1. Start servers once (background): `pnpm test:e2e:serve`
2. Confirm readiness with an HTTP health check (see below)
3. Run tests instantly: `pnpm test:e2e:run --grep "test name"`

Frontend changes auto-reload via HMR. Backend/schema changes can be hot-deployed without restarting.

Security note for audits: the admin key below is Convex's documented default key for the
local open-source backend, not a project secret. It is only safe when paired with the local
E2E backend URL from `.convex-local/.e2e-convex-url`; do not reuse this pattern for remote
Convex deployments or any real admin key.

```bash
npx convex deploy --admin-key 0135d8598650f8f5cb0f30c34ec2e2bb62793bc28717c8eb6fb577996d50be5f4281b59181095065c5d0f86a2c31ddbe9b597ec62b47ded69782cd --url "$(cat .convex-local/.e2e-convex-url)"
```

Only restart serve if you need a fresh database (new schema with incompatible data).

**Runtime URL injection:** E2E Convex URLs are injected through the frontend runtime config
pipeline in `frontend/scripts/runtime-config.ts` and `frontend/scripts/run-ng-with-runtime.ts`.
The harness passes ephemeral URLs into Angular defines (`__BRAKET_RUNTIME__`) instead of writing
committed frontend assets. This means:

- `pnpm start` and `pnpm test:e2e:serve` can run simultaneously without URL conflicts
- Hot-deploying backend changes does not require re-generating checked-in runtime files
- The runtime contract must stay aligned with `frontend/src/types/braket-runtime.d.ts`

### Detecting Server Readiness

Do NOT use log-parsing loops, `tail -f | grep`, or `sleep` waits. Use HTTP health checks:

```bash
# All three conditions must pass:
[ -f .convex-local/.e2e-port ] && [ -f .convex-local/.e2e-convex-url ] && [ -f .convex-local/.e2e-convex-site-url ] \
  && curl -sf "$(cat .convex-local/.e2e-convex-url)" > /dev/null \
  && curl -sf "http://127.0.0.1:$(cat .convex-local/.e2e-port)" > /dev/null \
  && echo "READY" || echo "NOT READY"
```

If not ready, report what's missing and let the user decide when to retry. Never block
on a long-running polling loop waiting for readiness.

## E2E vs Backend Test Boundary

E2E tests verify real user journeys through the UI. Backend logic belongs in `backend/convex/**/*.test.ts`.

- Every E2E test MUST include `page.goto()` and interact with page elements
- `convexHelper` is for test setup only (seeding data) — never the thing being tested
- **Never use `convexHelper.query()` as an assertion** — assert on DOM state via `expect(locator)`
- Revenue calculations, audit log records, tier math, DB field values → `backend/convex/**/*.test.ts`
- Litmus test: if removing all `page.*` calls leaves the test functionally unchanged, it's not E2E

**Origin:** PR #411 shipped 11 "E2E" tests that only called `convexHelper.mutation()`/`convexHelper.query()`. All passed. The buyer checkout was completely broken.

**Why this matters:** The Convex subscription chain (mutation → DB → WebSocket → signal → DOM) is
what E2E exists to verify. `convexHelper.query()` bypasses that chain entirely. A broken
subscription that never updates the UI will still pass if the assertion is on convexHelper.

## Common Pitfalls

### Toast overlays block clicks

Sonner toasts can overlay buttons. Dismiss before clicking:

```typescript
await page.keyboard.press('Escape');
await toast.waitFor({state: 'hidden'});
```

### Responsive layouts have separate DOM

Desktop (`hidden md:block`) and mobile (`md:hidden`) are separate elements. Use viewport-aware targeting:

```typescript
const isMobile = (page.viewportSize()?.width ?? 0) < 768;
const container = isMobile ? 'div.md\\:hidden' : 'div.hidden.md\\:block';
```

Add `data-testid` to BOTH desktop and mobile variants.

### Date timezone in tests

`new Date('2030-12-15')` creates UTC midnight = Dec 14 in US timezones.
Use `new Date(2030, 11, 15)` for local dates.

### WebKit dialog timing race

```typescript
await Promise.all([
  page.waitForEvent('dialog').then((d) => d.accept()),
  button.click(),
]);
```

### Signal Forms + Playwright in zoneless Angular

`[field]` directive alone doesn't trigger change detection from Playwright's synthetic events. Add `zInput`:

```html
<input zInput [field]="f.password" />
```

Then in tests: `fill()` + `dispatchEvent(new Event('input', { bubbles: true }))` + `blur()`.

### Never use CSS class selectors for assertions

Use `data-testid` attributes, not `.text-red-400`.

### Targeted test runs for debugging

With `pnpm test:e2e:serve` running, use `--grep "test name"` to run a single test:

```bash
pnpm test:e2e:run --grep "test name"
```

### Cross-project static data collisions

All Playwright projects share one backend. Make test data unique per run (`Date.now()` + unique names).
