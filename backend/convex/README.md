# Convex Backend Guide

This folder contains the Braket Tickets backend code: schema, functions, auth glue, checkout/refunds, and scheduled jobs.

This README is intentionally high-level. Treat source files as the source of truth for exact function names, args, and table fields.

## What Lives Here

```text
convex/
├── schema.ts             # Data model
├── lib/                  # Shared helpers and domain modules (no function registration)
├── **/_impl/             # Private implementation folders (ESLint-enforced)
├── _generated/           # Convex generated types and API bindings
├── auth/                 # Auth functions (feature folder)
├── communities/          # Community functions (feature folder)
├── events/               # Event functions (feature folder)
├── guest_sessions/       # Guest-session functions (feature folder)
├── marketing/            # Marketing functions (feature folder)
├── orders/               # Order functions (feature folder)
├── payments/             # Payment/refund functions (feature folder)
├── resale/               # Resale functions (feature folder)
├── stripe/               # Stripe functions (feature folder)
├── http/                 # HTTP handlers + router glue (feature folder)
├── root_admin/           # Root-admin-only surfaces (feature folder)
├── tickets/              # Ticket functions (feature folder)
├── users/                # User profile functions (feature folder)
├── crons.ts              # Scheduled jobs
└── testing/              # Test-only functions + seed helpers (api.testing.*)
```

Feature modules (for example `events/*`, `tickets/*`, `orders/*`, `communities/*`) live alongside these files.
The Convex root is reserved for infra/config files; new domain APIs belong in feature folders.

## Non-Negotiables

1. Public endpoints use bare `query()` / `mutation()` with handler-level auth checks.
2. Do not use `queryWithRLS()` / `mutationWithRLS()`; the RLS wrapper was removed.
3. All authz graph access goes through `convex/lib/authz.ts` domain wrappers. Do not call `components.authz.rebac.*` directly outside that file.
4. `convex/lib/authz.ts` owns authz graph semantics. Direct tuple helpers are not policy APIs; feature code should use semantic helpers such as `resolveOrganizerAccess(...)`.
5. Direct `Authz` class calls are allowed only in the authz boundary and authz-management modules that grant or revoke roles and relations.
6. Internal-only work should use `internalQuery` / `internalMutation`.
7. Keep `any` out of backend code; use concrete types or `unknown` with narrowing.

Minimal pattern:

```ts
import {query} from './_generated/server';
import {v} from 'convex/values';
import {getAuthUserId} from './lib/auth_helpers';
import {requireManageCommunity} from './lib/access';
import {throwUnauthenticated} from './lib/errors';

export const listSomething = query({
  args: {organizerId: v.id('organizers')},
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUnauthenticated();
    await requireManageCommunity(ctx, userId, args.organizerId);
    return ctx.db.query('someTable').collect();
  },
});
```

## Directory Contract

Use these directories consistently:

- `convex/**/*.ts` (excluding `**/_impl/**`)
  - Registered Convex functions only (queries/mutations/actions/http actions)
  - Thin orchestration, auth checks, validators, and calls into helpers
  - Keep public function names stable unless you intentionally want to change generated API paths

- `convex/**/_impl/**`
  - Private implementation (ESLint-enforced)
  - May not register Convex functions
  - Only importable by code in the owning directory tree (plus the sibling owner module file)

- `convex/lib/**`
  - Shared helpers and domain modules (never registers Convex functions)
  - Good home for read models, domain math, validator groups, and reusable auth/permission logic

## Query Scan Helpers

Use explicit helper names for async iterable scans:

- `takeFromQuery(query, limit)` for bounded reads from an `AsyncIterable`
- `collectAllQueryUnsafe(query)` only when you intentionally need the full result set
- `countMatchingInQuery(query, predicate, stopAfter?)` when the logic is inherently count-based

Do not hide unbounded reads behind vague helper names. If a full scan is still required, keep it in a domain helper and explain why that exact read shape is necessary.

## Import Direction

Prefer imports in this direction:

- registered function modules -> `convex/**/_impl/**` (same feature only)
- registered function modules -> `convex/lib/**`
- helpers -> `convex/lib/**`

Avoid this direction:

- one top-level API file importing helpers from another top-level API file

If code in `convex/resale/listings.ts` wants a helper from `convex/payments/refunds.ts`, that helper should move into `convex/lib/payments/**` or `convex/lib/**` first.

## When To Extract

Extract logic out of a top-level file when any of these are true:

- the file is mixing multiple concerns
- the same validator or literal union appears in more than one file
- a helper is meaningful outside one handler
- a block is large enough that it hides the registered API surface
- another top-level API file wants to reuse the logic

Rule of thumb: top-level files should read like the backend API surface, not like a dumping ground for every implementation detail.

## How To Make Safe Changes

1. Check `convex/schema.ts` first.
2. Verify live schema and signatures with MCP (`tables`, `functionSpec`) before coding.
3. Implement the change.
4. Verify behavior with targeted tests.
5. Run full validation before handing off.

For data-level debugging, use MCP `data` or `runOneoffQuery`, then check logs.

## Local Workflow

```bash
# Convex dev
pnpm convex dev

# Backend lint + typecheck
pnpm lint:convex
pnpm typecheck:convex

# Unit tests (backend)
pnpm test:convex

# Unit tests (all)
pnpm test:unit

# Final gate before done
./scripts/validate.sh all
```

Use `pnpm` only. Do not use `npm` or `yarn` in this repo.

## Payments Notes

- Stripe is the only payment path.
- Ticket issuance should happen only after successful payment finalization.

## Keeping This File Fresh

If this README starts drifting, prefer updating guidance over adding a big static API list.

When you need current specifics:

- Tables and fields: `convex/schema.ts` + MCP `tables`
- Callable functions: MCP `functionSpec`
- Security rules: `convex/lib/authz.ts`, `convex/lib/permissions.ts`, and the handler-level checks in the registered function modules

## References

- [Convex Schema](./schema.ts)
- [Authz Helpers](./lib/authz.ts)
- [Validation Helpers](./lib/validation.ts)
- [Backend Agent Rules](./AGENTS.md)
- [Security Docs](../docs/security.md)
- [Convex Best Practices](https://docs.convex.dev/understanding/best-practices/)
- [Convex Docs](https://docs.convex.dev)
