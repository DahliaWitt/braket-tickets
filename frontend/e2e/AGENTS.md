# E2E Test Rules

Rules for writing and modifying Playwright E2E specs. These override general coding instincts.

## The #1 Rule

**E2E tests test the UI. Not the backend. Not the database.**

`convexHelper` is for **seeding test data only** — never for assertions. If your test's core
assertion is `convexHelper.query()`, it belongs in `backend/convex/**/*.test.ts`, not here.

Origin: PR #411 shipped 11 "E2E" tests that only called `convexHelper`. All passed.
The buyer checkout was completely broken.

### Where assertions belong

| Assertion type | Correct location |
|---|---|
| Revenue math, tier pricing, fee calculations | `backend/convex/**/*.test.ts` |
| Audit log creation, record field values | `backend/convex/**/*.test.ts` |
| Security rules, RLS, permission checks | `backend/convex/**/*.test.ts` |
| Component renders X given input Y | Angular component test (Vitest + CDK Harness) |
| User navigates, interacts, sees result | **Here (E2E)** |

### The litmus test

Remove all `page.*` calls from the test. If it still catches the bug you're testing,
it's not an E2E test. Move the assertion to the appropriate unit test layer.

## Banned Patterns

### Never assert on convexHelper results
```typescript
// WRONG — bypasses the entire UI rendering pipeline
const tickets = await convexHelper.query(api.tickets.public.getMyTickets, {});
expect(tickets[0].tier).toBe('supporter');

// RIGHT — verify through what the user sees
await expect(page.getByTestId('ticket-tier')).toHaveText('Supporter');
```

### Never use force: true
It bypasses visibility, overlay, and enabled-state checks. Fix the root cause instead:
- Toast blocking? Dismiss it: `Escape` + `waitFor({ state: 'hidden' })`
- Not interactive yet? `await expect(button).toBeEnabled()`
- Viewport issue? Use responsive-aware selectors

### Never use bare .first() to resolve ambiguity
Scope to a container instead:
```typescript
// WRONG — matches first "$40" anywhere on the page
await expect(page.getByText('$40.00').first()).toBeVisible();

// RIGHT — scoped to the revenue section
const section = page.getByTestId('revenue-summary');
await expect(section.getByText('$40.00')).toBeVisible();
```
If no container exists, add `data-testid` to the component template.

### Never use waitForTimeout()
Every wait must be tied to a DOM state or assertion. The one exception is rate-limiting
retries in polling loops — and even then, document why.

### Never use networkidle
Convex holds a persistent WebSocket. `networkidle` hangs or resolves randomly.

### Never use CSS class selectors for assertions
Tailwind classes are implementation details. Use `data-testid`, ARIA roles, or text content.

## Required Patterns

### Use CDK Harnesses and Page Objects — not raw locators

Every component with a harness (`*.harness.ts`) MUST be interacted with through that harness
or its corresponding page object (`frontend/e2e/page-objects/*.page.ts`). Never write raw
`page.locator('#login-email')` or `page.getByTestId('submit-btn')` when a harness method exists.

**Why:** Raw locators are brittle — they break when IDs, test IDs, or DOM structure change. Harnesses
encapsulate selectors in one place. When a template changes, you fix ONE harness method instead of
every test that touches that element.

```typescript
// WRONG — raw locator, breaks when template changes
await page.locator('#login-email').fill('test@example.com');
await page.locator('#login-password').fill('password');
await page.locator('#login-submit').click();

// RIGHT — harness encapsulates all selectors
const loginHarness = await createEnvironment(page).getHarness(LoginComponentHarness);
await loginHarness.setLoginEmail('test@example.com');
await loginHarness.setLoginPassword('password');
await loginHarness.submitLogin();
```

**Before writing a new E2E test**, check if the target component already has:
1. A CDK harness (`*.harness.ts` alongside the component) — use via `createEnvironment(page).getHarness()`
2. A page object (`frontend/e2e/page-objects/*.page.ts`) — use via the test fixture

**If neither exists**, create a harness first. All new components require a CDK harness
(see `frontend/AGENTS.md` → New Component Requirements). E2E specs that bypass existing harnesses
will be rejected.

### Signal Forms: always trigger change detection
```typescript
await input.fill(value);
await input.evaluate((el: HTMLInputElement) => {
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await input.blur();
```

### Async assertion form (always)
```typescript
// WRONG — evaluates once, no retry
expect(await locator.isVisible()).toBe(true);

// RIGHT — retries until timeout
await expect(locator).toBeVisible({ timeout: 10000 });
```

### Unique test data (always)
```typescript
const title = uniqueName('E2E Test Party'); // not a hardcoded string
```

### Dismiss toasts before next action
```typescript
await page.keyboard.press('Escape');
await page.locator('[data-sonner-toast]').waitFor({ state: 'hidden', timeout: 5000 });
```

## CDK Harness Gotcha (Zoneless Angular)

`@ngx-playwright/test`'s `locatorFor()` does a **single snapshot DOM query** with no retry.
`forceStabilize()` is a no-op for zoneless Angular. After any click that triggers a conditional
render (`@if`), harness methods must poll for a sentinel element before returning.

See `login.component.harness.ts` `awaitRendered()` pattern for reference.
