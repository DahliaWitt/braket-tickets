---
globs: frontend/e2e/**/*.e2e-spec.ts, frontend/e2e/helpers/**, frontend/e2e/test-utils/**
---

# E2E Spec Authoring

How to write resilient, non-flaky Playwright specs for this Angular + Convex app.

## CDK Harnesses Required

Every component with a harness (`*.harness.ts`) MUST be interacted with through that harness
(via `createEnvironment(page).getHarness()`) or its page object (`frontend/e2e/page-objects/*.page.ts`).
Never write raw `page.locator()` or `page.getByTestId()` when a harness method exists for that element.

**When adding `data-testid` to a template**, also add a corresponding method to the component's
CDK harness. When writing an E2E assertion, check for an existing harness first.

```typescript
// BAD — raw locator bypasses the harness
await page.locator('[data-testid="application-status"]').toBeVisible();

// GOOD — harness encapsulates the selector
const harness = await createEnvironment(page).getHarness(
  DashboardComponentHarness,
);
await expect.poll(() => harness.isApplicationStatusVisible()).toBe(true);
```

**Why:** Raw locators are brittle — they break when IDs or DOM structure change. Harnesses
encapsulate selectors so changes require fixing ONE method, not every test.

## Locator Strategy (priority order)

1. `getByRole()` — ARIA semantics, survives DOM restructuring
2. `getByLabel()` — form controls
3. `getByPlaceholder()` / `getByText()` / `getByAltText()`
4. `getByTestId()` — explicit test contracts, resilient to copy changes
5. `locator('[data-testid="..."]')` with `.filter()` — scoped compound selectors
6. CSS/XPath via `locator()` — **last resort only**

### Banned selectors

- **CSS classes**: never `.text-red-400`, `.bg-green-500`, etc. Tailwind classes are implementation details.
- **Deprecated `text=` engine**: never `locator('text=Foo')` or `locator('text=/foo/i')`. Use `getByText('Foo')` or `getByText(/foo/i)`.
- **`:text()` pseudo-selector**: never `locator('span:text("draft")')`. Use `locator('span').filter({ hasText: 'draft' })`.
- **Component tags as selectors**: never `locator('app-check-in span')`. Add `data-testid` to the relevant element instead.
- **Deep structural selectors**: never `locator('h3:has-text("X") + *')`. Add `data-testid` to the container.

### Scoping assertions

Never use `.first()` to dodge ambiguity. Scope to a container:

```typescript
// BAD — matches first "$40.00" anywhere on the page
await expect(page.getByText('$40.00').first()).toBeVisible();

// GOOD — scoped to the specific revenue section
const revenueSection = page.getByTestId('revenue-summary');
await expect(revenueSection.getByText('$40.00')).toBeVisible();
```

If no container exists, add `data-testid` to the component template. Both desktop and mobile variants need it.

## Waiting Patterns

### The golden rule

**Never use `waitForTimeout()`.** Every wait must be tied to a DOM state or assertion.

The one exception is rate-limiting retries in polling loops (e.g., email harness) — and even then, prefer `expect.poll()` intervals.

### Never use `networkidle`

Convex holds a persistent WebSocket open. `networkidle` will either hang forever or resolve at arbitrary times. Use `domcontentloaded` (already patched via `patchGotoDefault`) plus element-based readiness probes.

### Waiting for Convex data

After a mutation (via `convexHelper` or UI action), Convex pushes updates via WebSocket → Angular signal → DOM. Use web-first assertions with generous timeouts:

```typescript
// Seed data, then assert the reactive DOM update
await convexHelper.mutation(api.testing.events.seedEvent, { title, ... });
await page.goto('/events');
await expect(
  page.getByTestId('event-card').filter({ hasText: title })
).toBeVisible({ timeout: 15000 });
```

### Escalation ladder

| Pattern                                            | When                                                            |
| -------------------------------------------------- | --------------------------------------------------------------- |
| `expect(locator).toBeVisible({ timeout: 15000 })`  | Default — Convex data rendering in the UI                       |
| `expect.poll(async () => ..., { timeout: 30000 })` | Non-DOM state, accumulating side effects, or post-reload checks |
| `page.waitForFunction(() => ...)`                  | Last resort — `window.localStorage`, custom JS predicates       |

### Post-navigation readiness

`domcontentloaded` does not mean Angular has hydrated. Always assert a stable DOM landmark after `goto()`:

```typescript
await page.goto('/community-admin/events');
await expect(page.locator('header')).toBeVisible({timeout: 10000});
// NOW interact with page content
```

### SPA route changes

Angular Router uses the History API — no full page navigation occurs. Use `waitForURL()` after clicks that trigger routing, then assert a landmark:

```typescript
await page.getByRole('link', {name: 'Dashboard'}).click();
await page.waitForURL('**/dashboard');
await expect(page.getByTestId('dashboard-content')).toBeVisible({
  timeout: 10000,
});
```

Never use `page.waitForNavigation()` — it's deprecated and misses SPA route changes.

### Avoid `page.reload()` as a timing workaround

If you need `page.reload()` to see data that should already be there via subscription, the test (or app) has a timing bug. Prefer a longer assertion timeout. If reload is genuinely needed (e.g., testing cold-load behavior), document why.

## Test Data

### Always use `uniqueName()`

Every piece of test data that could appear in shared UI must be unique per run:

```typescript
// BAD — collides under parallel sharding or retries
const title = 'E2E Test Party';

// GOOD — unique per run
const title = uniqueName('E2E Test Party');
```

This applies to: event titles, user emails, community names, ticket tier names, trust link names.

### Seed before navigate (Pattern 1)

When possible, seed all test data before `page.goto()`. The Convex subscription will include the data on first load:

```typescript
const eventId = await convexHelper.mutation(api.testing.events.seedEvent, { title, ... });
await page.goto(`/community-admin/events/${eventId}/manage`);
```

### Navigate then act (Pattern 2)

When testing user actions (not just data display), the page is already open and subscribed. After the action, assert the reactive update:

```typescript
await page.getByRole('button', {name: /APPROVE/}).click();
await expect(page.getByText(/approved/i)).toBeVisible({timeout: 10000});
```

## Form Interaction (Signal Forms)

Angular Signal Forms in zoneless mode do not detect Playwright's synthetic `fill()` events. Always trigger change detection:

```typescript
await input.fill(value);
await input.evaluate((el: HTMLInputElement) => {
  el.dispatchEvent(new Event('input', {bubbles: true}));
});
await input.blur(); // triggers validation display
```

For inputs where `fill()` + `dispatchEvent` is still insufficient (autocomplete, custom keyboard handlers):

```typescript
await input.click();
await input.selectText();
await input.pressSequentially(value, {delay: 10});
await input.blur();
```

Always assert the submit button is enabled before clicking:

```typescript
await expect(submitBtn).toBeEnabled({timeout: 5000});
await submitBtn.click();
```

## Toast & Overlay Handling

Sonner toasts overlay buttons. Always dismiss and wait before the next interaction:

```typescript
await page.keyboard.press('Escape');
await page
  .locator('[data-sonner-toast]')
  .waitFor({state: 'hidden', timeout: 5000});
// NOW click the next button
```

Never use a `waitForTimeout()` as a substitute for waiting on the toast state.

## `force: true` — Almost Always Wrong

`force: true` bypasses all actionability checks (visibility, overlay detection, enabled state). It hides real bugs. The only valid use is a documented Playwright emulation artifact on specific viewports — and even then, add a comment explaining exactly why.

If you need `force: true` to make a test pass, the underlying issue is one of:

- A toast/overlay not dismissed (fix: dismiss it)
- An element not yet interactive (fix: wait for it)
- A viewport layout issue (fix: use responsive-aware selectors)

## Test Isolation

### No serial mode by default

`test.describe.configure({ mode: 'serial' })` should be rare. Each test must create its own data via `convexHelper` fixtures and not depend on state from previous tests.

Valid uses of serial mode: multi-step user journeys where the steps are intentionally sequential (e.g., "apply → review → approve" as one logical flow). Even then, prefer a single test with clear act/assert sections over multiple serial tests.

### Never mutate the global test user's state

`authedPage` and `adminPage` use shared global credentials. Tests that modify the global user's state (submitting vetting applications, changing settings) will break other tests using the same fixture.

For tests that mutate user state: seed a fresh user via `convexHelper`, log in as that user, and clean up after.

### Worker-scoped vs test-scoped fixtures

- **Worker-scoped** (`{ scope: 'worker' }`): expensive setup shared across tests in one worker (auth sessions, browser context)
- **Test-scoped** (default): per-test setup (page objects, seeded data, navigation)

## Assertions

### Always use async assertion form

```typescript
// BAD — evaluates once, no retry
expect(await locator.isVisible()).toBe(true);

// GOOD — retries until timeout
await expect(locator).toBeVisible();
```

### Count before iterating

```typescript
// BAD — .all() snapshots without waiting, may return empty
const items = await page.getByTestId('item').all();

// GOOD — wait for expected count, then iterate
await expect(page.getByTestId('item')).toHaveCount(3);
const items = await page.getByTestId('item').all();
```

### Dialog + click race

Always register the dialog listener before the click:

```typescript
await Promise.all([
  page.waitForEvent('dialog').then((d) => d.accept()),
  button.click(),
]);
```

## Debugging & Traces

Config (already set in `frontend/playwright.config.ts`):

```typescript
use: {
  trace: 'on-first-retry',
  screenshot: 'only-on-failure',
},
retries: process.env.CI ? 2 : 0,
```

To verify a new test isn't flaky: `pnpm test:e2e:run --grep "test name" --repeat-each=10`

Use `pnpm exec playwright show-report` to inspect traces — DOM snapshots, network, console logs, source lines for every action.

## Testing Boundary: E2E vs Backend

**`convexHelper` is for setup and teardown only — never for assertions.**

The Convex subscription chain (mutation → DB → WebSocket push → Angular signal → DOM update) is
what E2E tests exist to verify. Asserting on `convexHelper.query()` bypasses the entire rendering
pipeline. A broken subscription that never updates the UI will still pass.

```typescript
// BAD — tests Convex, not the UI. Belongs in backend/convex/*.test.ts
await page.getByRole('button', {name: /approve/i}).click();
const status = await convexHelper.query(api.applications.get, {id});
expect(status).toBe('approved');

// GOOD — tests the full stack through the UI
await page.getByRole('button', {name: /approve/i}).click();
await expect(page.getByTestId('application-status')).toHaveText(/approved/i, {
  timeout: 10000,
});
```

| What you're testing                                      | Correct layer                                  |
| -------------------------------------------------------- | ---------------------------------------------- |
| Business logic, calculations, invariants, security rules | `backend/convex/**/*.test.ts`                  |
| Component rendering, input validation display            | Angular component tests (Vitest + CDK Harness) |
| Real user journeys: navigate → interact → see result     | E2E (Playwright)                               |

**Signals you're in the wrong layer:**

- E2E assertion is `convexHelper.query()` → move to convex-test
- E2E assertion is revenue math, audit log records, or DB field values → move to convex-test
- E2E test checks one component's output with no navigation → move to component test

## Quick Checklist

Before submitting an E2E spec, verify:

- [ ] Every test has `page.goto()` and interacts with page elements (not just `convexHelper` calls)
- [ ] Zero `convexHelper.query()` used as assertions — only for setup/seeding
- [ ] Business logic assertions (revenue, audit logs, tier math) are in convex-test, not E2E
- [ ] All test data uses `uniqueName()` — no hardcoded titles/emails
- [ ] Zero `waitForTimeout()` calls (except rate-limited polling loops with a comment)
- [ ] Zero `networkidle` usage
- [ ] Zero `force: true` clicks (or each one has a documented justification)
- [ ] Zero deprecated `text=` or `:text()` selectors
- [ ] Signal Forms inputs use `dispatchEvent('input')` + `blur()`
- [ ] Toasts dismissed with `Escape` + `waitFor({ state: 'hidden' })` before next action
- [ ] Assertions use async form (`await expect(locator).toBeVisible()`, not `expect(await ...).toBe()`)
- [ ] No test depends on state from a previous test
- [ ] Assertions scoped to containers — no bare `.first()` to dodge ambiguity
- [ ] Stable after `--repeat-each=10` locally
