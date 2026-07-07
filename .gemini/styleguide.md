# Braket Tickets Code Review Style Guide

This guide gives Gemini Code Assist the project-specific review rules that are
easy to miss from generic TypeScript, Angular, or Convex knowledge. Treat the
canonical references below as authoritative when they conflict with this file.

---

## Canonical References

- `AGENTS.md` - repository-wide agent rules, command policy, validation strategy,
  and context-maintenance requirements
- `backend/convex/_generated/ai/guidelines.md` - official Convex API guidance;
  read before reviewing Convex changes
- `backend/convex/AGENTS.md` - Convex structure, authz, logging, testing, and
  query-scan rules
- `frontend/AGENTS.md` - Angular v22 zoneless, shared component, harness, and
  Storybook rules
- `.impeccable.md` - design system tokens and component patterns
- `docs/runbooks/` - operator-facing behavior, deploy, config, cron, env, and
  integration instructions

---

## Review Priorities

1. Security: auth bypasses, data exposure, payment misuse, unsafe env/config
2. Correctness: stale API assumptions, race conditions, wrong generated contracts
3. Convex performance: unbounded scans, missing indexes, N+1 authz/data access
4. Angular zoneless correctness: state not flowing through signals/resources
5. Maintainability: duplicated policy logic, local type redefinitions, drift risks

---

## Convex Backend

Convex code lives under `backend/convex/`. Do not review it from training-data
memory alone; verify the generated guidelines, local schema, indexes, validators,
and current feature folder layout.

### Function Registration

- Public functions use bare `query()`, `mutation()`, and `action()` from
  `_generated/server` with an explicit endpoint policy. Private surfaces need
  auth/access checks; public read models need visibility filtering; tokenized or
  abuse-prone flows need token and/or rate-limit checks.
- Do not introduce `queryWithRLS()` or `mutationWithRLS()`; those wrappers were
  removed.
- Internal-only functions use `internalQuery`, `internalMutation`, or
  `internalAction`.
- HTTP routes belong in `backend/convex/http.ts` and feature-local HTTP helpers.
- Every registered Convex function must define `args`; return validators should
  stay explicit and reuse shared validator primitives where the repo has them.

```typescript
// Bad: obsolete wrapper pattern.
export const list = queryWithRLS({
  args: {},
  handler: async (ctx) => ctx.db.query('events').collect(),
});

// Good: public read model with explicit visibility policy in the helper.
export const listPublic = query({
  args: {},
  handler: async (ctx) => listPubliclyVisibleEvents(ctx),
});

// Good: private surface with explicit auth/access policy.
export const listForManager = query({
  args: {eventId: v.id('events')},
  handler: async (ctx) => {
    const {_id: callerId} = await requireUser(ctx);
    await requireManageEvent(ctx, callerId, eventId);
    return listManagedEventData(ctx, eventId);
  },
});
```

### Structure

- Registered Convex exports live in feature modules such as `events/*`,
  `communities/*`, `orders/*`, `payments/*`, `stripe/*`, `tickets/*`, and
  `users/*`.
- Do not add new domain API files at the Convex root; root files are for
  infrastructure/config such as `schema.ts`, `http.ts`, and `crons.ts`.
- Top-level feature API files should stay thin: validators, auth, orchestration,
  and calls into helpers.
- Domain implementation belongs in `backend/convex/<feature>/_impl/**`.
- Shared cross-domain helpers belong in `backend/convex/lib/**`.
- Do not import one registered-function module from another.
- Do not import another feature's `_impl/**` private implementation.
- If adding a shared helper, grep for duplicates and migrate them in the same
  change so the helper does not ship next to divergent logic.

### Authorization

- All authorization decisions for view, purchase, edit, manage, and scan flows
  go through `backend/convex/lib/access.ts`.
- Feature code must not call `authz.can()` directly for access decisions.
- Feature code must not call `components.authz.*` directly. Keep ReBAC library
  access behind `backend/convex/lib/authz.ts` and expose policy decisions through
  `access.ts`.
- Use the direct composition pattern: resolve the caller with `requireUser(ctx)`,
  then pass the caller id into `can*` / `require*` access functions.
- Do not inline visibility checks, trust-edge enumeration, membership checks, or
  organizer access resolution in handlers.

```typescript
// Bad: feature-local policy drift.
const allowed = await authz.can(ctx, userId, 'event:manage', {
  type: 'event',
  id,
});

// Good: central access policy.
const {_id: callerId} = await requireUser(ctx);
await requireManageEvent(ctx, callerId, eventId);
```

### Query Patterns

- Prefer `withIndex(...)`; avoid `.filter((q) => ...)` on hot or user-facing
  paths.
- Index fields must be queried in the same order they are defined in schema.
- Avoid unbounded `.collect()`. Use `.take(n)`, `.paginate(...)`, or the local
  helpers in `backend/convex/lib/query_scan.ts`.
- Use `takeFromQuery(...)` for bounded async-iterable reads.
- Use `collectAllQueryUnsafe(...)` only for deliberate full scans with a clear
  reason in code.
- Do not use `.collect().length` for counting on production paths; use counters
  or bounded/count helper patterns.
- Use `.unique()` only when the index actually guarantees uniqueness.

### Schema, Validators, and Seeds

- Do not store unbounded arrays in documents; use child tables with foreign keys.
- Index names should include all index fields, for example
  `by_field1_and_field2`.
- Use `v.null()` and `null` for absent Convex values; `undefined` is not a
  stored Convex value.
- Keep repeated literal unions and return-shape fragments centralized.
- When schema or validator changes alter required fields, enums, or field shapes,
  update affected `backend/convex/testing/**` seed helpers in the same change.
- Test/seed setup should use production mutations and the patterns under
  `backend/convex/testing/AGENTS.md`.

### Actions and Node Runtime

- Add `"use node";` only to files that need Node.js built-ins.
- Do not put `"use node";` in files that also export queries or mutations.
- Actions do not have direct database access through `ctx.db`; use internal
  queries/mutations or extract shared pure helpers.
- Do not split transactional logic into unnecessary `ctx.runQuery` /
  `ctx.runMutation` calls; that can create race windows.

### Logging and Errors

- Use `logger` from `backend/convex/lib/logger.ts` for backend runtime logging.
- Do not use raw `console.log/info/warn/error` in Convex runtime code.
- Keep PII, secrets, tokens, emails, phone numbers, card-like values, and raw
  provider payloads out of logs and client-visible errors.
- Prefer existing shared error helpers/contracts over feature-local error shapes.

### Convex Types

- Use `Id<"tableName">` and `Doc<"tableName">` from `_generated/dataModel`.
- Use `QueryCtx`, `MutationCtx`, and `ActionCtx` from `_generated/server`.
- Do not use `any`; use concrete types or `unknown` plus narrowing.

---

## Angular Frontend

The frontend uses Angular v22+ with zoneless change detection. Review changes
for current Angular APIs, signal/resource usage, accessibility, and project UI
contracts.

### Signals and Async State

- Use signals for component state: `signal()`, `computed()`, `input()`,
  `output()`, and `model()` where appropriate.
- Use `resource()` for async loading in components when it fits the existing
  pattern.
- Use `toSignal()` when converting existing Observables for component binding.
- Do not add `zone.js`.
- Do not add `FormGroup`, `FormControl`, or `ReactiveFormsModule` for new work.
- Do not use `BehaviorSubject` or RxJS subjects for local component state.
- Do not rely on `ApplicationRef.tick()`, `ChangeDetectorRef.detectChanges()`,
  `NgZone.run()`, or `NgZone.runOutsideAngular()`.

```typescript
// Bad: legacy local state and manual change detection.
constructor(private cdr: ChangeDetectorRef) {}

ngOnInit() {
  this.data$.subscribe((data) => {
    this.data = data;
    this.cdr.detectChanges();
  });
}

// Good: signal-backed binding.
readonly data = toSignal(this.data$, {initialValue: null});
```

### Components and Templates

- Prefer standalone components with explicit imports.
- Use `inject()` for dependency injection.
- Use `@if`, `@for`, and `@switch` instead of legacy structural directives in
  new code.
- Bind to signals by calling them in templates: `{{ value() }}`.
- Keep `effect()` callbacks narrow and side-effect oriented; do not hide
  business logic inside effects.
- Use `frontend/src/app/utils/logger.ts` for frontend logging, not raw console
  calls, unless the bypass is intentional and documented.

### Generated Convex API Types

- Do not redefine Convex function argument or return types on the frontend.
- Derive frontend contracts from generated API references with
  `FunctionArgs<typeof api.x.y>` and `FunctionReturnType<typeof api.x.y>`.

```typescript
import {api} from '@convex/_generated/api';
import type {FunctionArgs, FunctionReturnType} from 'convex/server';

type CreateEventArgs = FunctionArgs<typeof api.events.management.create>;
type EventDetail = NonNullable<
  FunctionReturnType<typeof api.events.public.get>
>;
```

### Testing

- Frontend tests should use CDK Harnesses.
- Do not use `nativeElement.querySelector`, `fixture.nativeElement`, or ad-hoc DOM
  selectors in specs.
- If a component/page lacks a harness, add a focused harness before adding
  behavior tests.
- Run filtered frontend specs from the repo root with
  `pnpm test:frontend -- path/to/spec.ts`.

### Shared UI Components

- Check ZardUI before creating a new shared UI primitive.
- `z-` is reserved for ZardUI-derived components pulled/copied from ZardUI and
  customized for Braket.
- `bra-` is for Braket-native shared components built from scratch.
- Do not prefix feature/page components; prefixes are for the shared UI library.
- New shared UI components need a CDK harness and a colocated Storybook story.
- Use CVA for multi-variant component styling.
- Use Pulp semantic tokens such as `--primary`, `--success`, `--warning`, and
  `--destructive`; avoid hardcoded colors for themeable UI.
- Meet WCAG 2.1 AA expectations for roles, labels, keyboard behavior, focus, and
  contrast.

### Visual Changes

- For visual frontend changes, prefer the repo screenshot helper:
  `pnpm run screenshot:frontend -- /route --auth admin|user|none`.
- Do not report screenshot tooling as unavailable without checking the repo
  command first.

---

## Payments, Auth, and External Integrations

- Never store card data. Stripe tokenizes on the frontend; payment/refund
  processing belongs in backend Convex payment modules.
- Treat auth, account-linking, email, Stripe, env, and deployment changes as
  high-risk.
- Verify provider APIs and repo wrappers before changing integration behavior.
- If behavior, deployment, config, cron jobs, env vars, external integrations, or
  operator commands change, update the affected `docs/runbooks/` files in the
  same change.
- Do not document commands, env vars, container names, function names, or paths
  without verifying them against current repo sources.

---

## Context Artifacts

- Treat stale, missing, inconsistent, or low-quality `AGENTS.md`, `CLAUDE.md`,
  rules, skills, workflows, and plans as Agent Lint work.
- Before creating or updating context artifacts, use
  `agentlint_get_guidelines` for the artifact type when the tool is available.
- For targeted context changes, use `agentlint_quick_check` with the touched
  paths or a short change description.
- For broad workspace context reviews or fixes, start with
  `agentlint_plan_workspace_autofix`.
- If Agent Lint tooling is unavailable, say so in the handoff and verify the
  context update against current repo evidence instead of guessing.

---

## Commands and Validation

- Use `pnpm` only; do not use `npm` or `yarn`.
- Do not run `ng test`; use `pnpm test:frontend` or
  `pnpm test:frontend:watch`.
- Do not run Playwright directly with `npx playwright test`; use the repo E2E
  harness commands.
- Run targeted checks while iterating:
  - `pnpm typecheck:frontend`
  - `pnpm typecheck:convex`
  - `pnpm test:frontend -- path/to/spec.ts`
  - `pnpm test:convex`
  - `pnpm lint:convex`
- Reserve `pnpm validate` for final integration checks or CI unless explicitly
  requested.
- Use `./scripts/validate.sh all` or `./scripts/validate.sh full` only when an
  E2E-inclusive validation run is explicitly requested.
- Do not wrap commands that already inject Doppler, including `pnpm dev`,
  `pnpm test:frontend`, `pnpm test:e2e*`, `pnpm lint:angular`, and
  `pnpm validate`.

---

## Git and Review Hygiene

- Keep commits Conventional Commit formatted:
  `<type>(<scope>): <description>`.
- Prefer scopes already used by the repo, such as `frontend`, `convex`, `e2e`,
  `docs`, `auth`, `payments`, or the touched feature area.
- Do not use AI filler words such as "comprehensive", "robust", "seamless",
  "ensures", "elegant", or "utilize" in commit messages or review prose.
- Do not leave temporary debug artifacts such as `*.txt`, `*.log`, or `temp_*`.
- Do not leave `git stash` entries behind.
- Do not recommend destructive or worktree-rewriting git operations unless the
  user explicitly asked for them.
- If `LINT.IfChange` / `LINT.ThenChange` annotations are touched, verify and
  update the coupled files.
