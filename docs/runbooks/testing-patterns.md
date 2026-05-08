---
title: Testing Patterns
category: Runbooks
order: 16
description: Incident response runbook — testing patterns
access: public
---

# Convex Testing Patterns

This runbook is for engineers writing or reviewing backend Convex tests. It explains why test setup must go through production mutations and how to apply the correct patterns.

Source of truth:

- `backend/convex/testing/AGENTS.md` — the authoritative agent guide with code examples
- `backend/convex/testing/**` — test-only helpers under the `api.testing.*` namespace
- `eslint-rules/no-raw-db-mutations.js` — the lint rule that enforces the pattern

## Why single source of truth matters

Tests that bypass production mutations can pass while the app is broken.

Here is a real failure mode: an engineer adds a required field to the `events` table and updates the `events.create` mutation to set it. Every existing test that creates events by calling `ctx.db.insert('events', {...})` directly omits the new field. The tests compile and pass because the schema validator accepts the field as optional at the database layer. But the production mutation—the one users actually call—now always sets the field. Any feature code that reads the field will see `undefined` for documents created via the test path.

The fix is for tests to create entities through the same mutations users do. That way the mutation's validation, defaults, and side effects are always exercised together with the test assertion.

## Setup patterns

### Creating entities through production mutations (preferred)

Most entities have a production mutation. Use it.

```typescript
// 1. Bootstrap a user — no production signup flow in tests, so use the composite
const userId = await t.mutation(api.testing.users.createUserDirectly, {
  email: 'alice@example.com',
  name: 'Alice',
  authEmailVerified: true,
});

// 2. Create an auth context
const asAlice = t.withIdentity({subject: userId});

// 3. Create an organizer as the user (or use the seed composite if authz isn't the focus)
const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
  name: 'Test Org',
});

// 4. Create the entity you're actually testing through the real mutation
const eventId = await asAlice.mutation(api.events.management.create, {
  title: 'Test Event',
  date: '2030-06-01T00:00:00.000Z',
  price: 1000,
  organizerId,
});
```

### Using `api.testing.*` helpers

Some setup cannot go through a production mutation because no public mutation exists for it. The `api.testing.*` helpers handle these cases.

**User bootstrap** — Better Auth's signup flow does not run in the Vitest environment. `createUserDirectly` inserts the app user record directly, which is the correct substitute:

```typescript
const userId = await t.mutation(api.testing.users.createUserDirectly, {
  email: 'bob@example.com',
  name: 'Bob',
});
```

**Role and membership assignment** — Granting a user `community_admin` or `root_admin` requires direct calls to the authz library. There is no single public mutation that wraps this:

```typescript
await t.mutation(api.testing.communities.seedCommunityAdmin, {
  grantedBy: rootAdminUserId,
  organizerId,
  userId,
});
```

**Multi-step composite state** — When a test needs an organizer + multiple events + an approved application before it can begin, the seed composites avoid repetitive boilerplate:

```typescript
const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
  name: 'Anfangszeit',
});
const eventId = await t.mutation(api.testing.events.seedEvent, {
  organizerId,
  title: 'Night Market',
  date: '2030-09-01',
  price: 500,
});
```

**Intentionally invalid states** — Some tests verify that error handling works correctly when data is in a state production mutations would never produce. A composite with a clear comment is acceptable for this.

### Reading state after mutations

`ctx.db.get()` and `ctx.db.query()` reads inside `t.run()` are acceptable for inspecting the outcome of a mutation:

```typescript
// Trigger the action
await asAlice.mutation(api.communities.applications.review, {
  applicationId: appId,
  status: 'approved',
});

// Inspect state via reads — this is fine
const membership = await t.run(async (ctx) =>
  ctx.db
    .query('applications')
    .filter((q) => q.eq(q.field('userId'), userId))
    .first(),
);
expect(membership?.status).toBe('approved');
```

Reads do not bypass production invariants, so they do not create the false-positive problem that write bypasses do.

## What is forbidden

**Direct `db.insert()` / `db.patch()` in test files.**

```typescript
// BAD — bypasses mutation validation, slug generation, derived state
await t.run(async (ctx) => {
  await ctx.db.insert('organizers', {name: 'Test Org', slug: 'test-org', ...});
});
```

The ESLint rule `no-raw-db-mutations/no-raw-db-mutation` enforces this across all `*.test.ts` and seed files. It is set to `error`. Disabling it requires explicit user approval.

### When raw db is justified

Rarely, a test needs to verify behavior against data in a state the production API cannot produce — for example, simulating a legacy document shape from before a migration. In that case:

1. Add `// eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation` on the line directly above the insert.
2. Add a comment explaining exactly why a production mutation cannot be used.
3. Get user approval before adding the disable comment.

```typescript
// eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation
// Reason: simulating a pre-migration document that lacks the `status` field
// to verify the migration backfill handles nulls correctly.
await ctx.db.insert('events', {title: 'Legacy', date: '2020-01-01', price: 0});
```

## Auth context in tests

The vitest mock in `backend/convex/testing/vitest.setup.ts` replaces the Better Auth session lookup. When you call `t.withIdentity({subject: userId})`, the mock resolves the auth identity to `userId` directly, so every authenticated production mutation works without a real session.

```typescript
const asUser = t.withIdentity({subject: userId});
// Now all mutations called via asUser will see this userId as the authenticated user
await asUser.mutation(api.events.management.create, {...});
```

This means the auth mock must stay aligned with `backend/convex/lib/auth_helpers.ts`. If you change how `getAuthUserId` works in production, update the mock in `vitest.setup.ts` too.

## Adding a new `api.testing.*` helper

When a new table is added to the schema:

1. Add a `seed<TableName>` helper under `backend/convex/testing/<domain>.ts` using `testingMutation`.
2. Import the same validator functions the production mutation uses — do not duplicate the validation.
3. Accept all required fields as args; provide sensible defaults for optional fields.
4. If the entity has derived state (authz memberships, marketing preferences, projection fields), call the same helpers the production mutation calls.
5. If remote seed scripts need the operation, expose a narrow token-gated method under `backend/convex/seed/`; do not make `DEV_SEED` authorize the broader `api.testing.*` namespace.

```typescript
export const seedWidget = testingMutation({
  args: {
    name: v.string(),
    organizerId: v.id('organizers'),
    status: v.optional(v.union(v.literal('draft'), v.literal('active'))),
  },
  returns: v.id('widgets'),
  handler: async ({db}, args) => {
    validateWidgetFields(args); // same as production mutation
    return await db.insert('widgets', {
      name: args.name,
      organizerId: args.organizerId,
      status: args.status ?? 'draft',
    });
  },
});
```

## After schema changes

Run these after any change to `schema.ts` or validators:

```bash
pnpm typecheck:convex
pnpm test:convex
```

TypeScript will surface any seed helper that is missing a newly required field.
