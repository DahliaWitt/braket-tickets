---
globs: backend/convex/**/*.test.ts, backend/convex/testing/**, backend/scripts/seed*.ts
---

# Testing Rules

## Test Setup

- Use production mutations (`asUser.mutation(api.*.create, {...})`) for test setup, not raw `ctx.db.*`.
- Use `api.testing.*` composites only for: user bootstrap, authz/role assignment, multi-step composites, intentionally invalid states.
- Never `eslint-disable no-raw-db-mutations/no-raw-db-mutation` without user approval.
- Seed scripts follow the same rules as tests.
- Raw `ctx.db.get()` / `ctx.db.query()` reads in tests are acceptable.
- See `backend/convex/testing/AGENTS.md` for the full guide.
