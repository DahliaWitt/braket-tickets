# Convex Testing — Agent Instructions

## Before Writing Tests

Load these skills first:

- `.agents/skills/convex-best-practices/SKILL.md`
- `.agents/skills/convex-functions/SKILL.md`
- `.agents/skills/convex-security-check/SKILL.md`

## The Single Source of Truth Principle

Production mutations are the API. Tests must exercise the real API.

When a test creates an organizer by calling `db.insert('organizers', {...})` directly, it
bypasses the validation, slug generation, and invariant enforcement in the production
`createCommunity` mutation. If that mutation adds a new required field, the direct insert
silently omits it — tests stay green while the app is broken.

The rule: **production mutations are the setup path for tests, the same as they are for
users.** Seed helpers live under `convex/testing/**` (the `api.testing.*` namespace).
They may use raw `db.insert/patch/delete` only when bootstrap is required, and must wrap
those calls with an explicit `no-raw-db-mutations/no-raw-db-mutation` disable + comment.
Test files themselves must not raw-mutate the DB.

## Test Setup Hierarchy

```
1. Production mutations (preferred)
      t.withIdentity({subject: userId}).mutation(api.communities.profile.create, {...})

2. api.testing.* helpers (bootstrap, authz, edge cases)
      t.mutation(api.testing.communities.seedOrganizer, {...})
      t.mutation(api.testing.users.createUserDirectly, {...})

3. ctx.db.insert() / ctx.db.patch() — FORBIDDEN in test files
      Only allowed inside `convex/testing/**` helper modules, with an explicit
      eslint disable + bootstrap justification.
```

### Level 1: Production mutations (use by default)

For any entity the app can create through the UI, use the production mutation:

```typescript
// Create a user (bootstrap — no production mutation exists for this)
const userId = await t.mutation(api.testing.users.createUserDirectly, {
  email: 'alice@example.com',
  name: 'Alice',
});

// Authenticate as that user
const asAlice = t.withIdentity({subject: userId});

// Create an event through the real mutation
const eventId = await asAlice.mutation(api.events.management.create, {
  title: 'Test Event',
  date: '2030-06-01T00:00:00.000Z',
  price: 1000,
  organizerId,
});
```

This ensures that any validation, side effects, or derived state that the production code
applies is also applied in tests.

### Level 2: `api.testing.*` helpers

Use `api.testing.*` helpers only when:

- **User bootstrap**: No production signup flow exists in tests; use
  `createUserDirectly` to insert a user and optional Better Auth record.
- **Authorization / role assignment**: Granting roles via `authz.assignRole()` or
  `addMember()` requires direct library calls that do not have a single public
  production-API wrapper. Use the dedicated seed helpers.
- **Multi-step composite state**: A single test needs an organizer + event + application
  pre-approved in one call. A seed composite is fine to reduce boilerplate when the
  composite is reused across many tests.
- **Intentionally invalid states**: A test needs a record in an inconsistent state that
  production mutations would reject. Use a composite with a clear comment explaining why.
- **E2E seeding via convexHelper**: Playwright tests call `api.testing.*` helpers
  through `convexHelper.mutation()` to seed data before navigation.

```typescript
// Bootstrap user (no production mutation available for this)
const userId = await t.mutation(api.testing.users.createUserDirectly, {
  email: 'bob@example.com',
  name: 'Bob',
  authEmailVerified: true,
});

// Seed an organizer (composite: validates + inserts + handles slug)
const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
  name: 'Test Org',
});

// Authenticate as an approved member
const asBob = t.withIdentity({subject: userId});
```

### Level 3: Raw db — forbidden in test files

Do NOT use `t.run(async (ctx) => ctx.db.insert(...))` or
`t.run(async (ctx) => ctx.db.patch(...))` in test files to create or mutate entities.

There is no good reason to raw-mutate the DB in test files. If you believe an exception
is warranted, explain why to the user and wait for approval before adding it.

**One exception**: `ctx.db.get()` and `ctx.db.query()` reads inside `t.run()` are
acceptable for inspecting state after a mutation fires. Reads do not bypass production
invariants.

```typescript
// OK — reading back state to assert on it
await t.run(async (ctx) => {
  const ticket = await ctx.db.get('tickets', ticketId);
  expect(ticket?.status).toBe('confirmed');
});

// NOT OK — creating state that bypasses production mutations
await t.run(async (ctx) => {
  await ctx.db.insert('tickets', {...}); // forbidden: bypasses production invariants
});
```

## Auth Context Patterns

Tests use three layers of auth context:

### 1. Bootstrap (no auth context needed)

`createUserDirectly` and other `api.testing.*` bootstrap helpers run without auth,
because they represent setup before any user session exists:

```typescript
const userId = await t.mutation(api.testing.users.createUserDirectly, {
  email: 'carol@example.com',
  name: 'Carol',
});
```

### 2. Authenticated context

After bootstrapping, use `t.withIdentity({subject: userId})` to get an authenticated
context. The vitest mock in `testing/vitest.setup.ts` maps `subject` directly to the
user ID, bypassing Better Auth's session lookup:

```typescript
const asCarol = t.withIdentity({subject: userId});
```

### 3. Acting as an authenticated user

Use the authenticated context to call production mutations:

```typescript
const eventId = await asCarol.mutation(api.events.management.create, {
  title: "Carol's Event",
  // ...
});
await asCarol.mutation(api.communities.applications.submit, {
  answers: {why: 'Testing'},
});
```

### Full auth flow example

```typescript
const t = convexTest();

// Bootstrap
const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
  name: 'Test Org',
});
const userId = await t.mutation(api.testing.users.createUserDirectly, {
  email: 'dave@example.com',
  name: 'Dave',
  authEmailVerified: true,
});

// Auth context
const asDave = t.withIdentity({subject: userId});

// Act using production mutations
await asDave.mutation(api.communities.applications.submit, {
  answers: {why: 'I want in'},
});

// Assert via reads (acceptable)
const app = await t.run(async (ctx) =>
  ctx.db
    .query('applications')
    .filter((q) => q.eq(q.field('userId'), userId))
    .first(),
);
expect(app?.status).toBe('pending');
```

## Adding New `api.testing.*` Helpers

When a new entity type is added to the schema:

1. Add a `seed<TableName>` helper under `convex/testing/<domain>.ts` using `testingMutation`.
2. Import and call the same validation helpers the production mutation uses (e.g.,
   `validateUpdateEventInput`). Do not duplicate the validation logic.
3. Accept all required fields as args and provide sensible defaults for optional fields.
4. If the new entity has derived state or side effects (e.g., authz membership, marketing
   preferences), call those helpers inside the composite, mirroring the production mutation.

```typescript
export const seedWidget = testingMutation({
  args: {
    name: v.string(),
    organizerId: v.id('organizers'),
    status: v.optional(v.union(v.literal('draft'), v.literal('active'))),
  },
  returns: v.id('widgets'),
  handler: async ({db}, args) => {
    validateWidgetFields(args); // same validator as production mutation
    return await db.insert('widgets', {
      name: args.name,
      organizerId: args.organizerId,
      status: args.status ?? 'draft',
    });
  },
});
```

## Seed Scripts

Seed scripts use the token-gated `backend/convex/seed/` facade, not direct
`api.testing.*` calls. Keep shared insert logic in plain helper functions so
tests and seed scripts can both call the same implementation. If a remote seed
workflow needs a new operation, add a narrow facade method under
`backend/convex/seed/` instead of broadening `DEV_SEED` access to test helpers.

## Quick Reference

| Operation               | Correct approach                                           |
| ----------------------- | ---------------------------------------------------------- |
| Create a user           | `t.mutation(api.testing.users.createUserDirectly, {...})`  |
| Authenticate            | `t.withIdentity({subject: userId})`                        |
| Create domain entity    | `asUser.mutation(api.<module>.create, {...})`              |
| Bootstrap organizer     | `t.mutation(api.testing.communities.seedOrganizer, {...})` |
| Read state after action | `t.run(async (ctx) => ctx.db.get(...))` — reads are OK     |
| Write state in test     | **Do not.** Use a production mutation or composite.        |
| Disable eslint rule     | **Do not** without explicit user approval.                 |
