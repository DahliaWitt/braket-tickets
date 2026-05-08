# Convex Backend

This folder has two jobs:
- root files in `convex/` hold infra and configuration (`schema.ts`, `http.ts`, `crons.ts`, etc.)
- feature directories define registered Convex functions with thin orchestration
- internal subdirectories hold shared logic, validators, and private feature implementations

## Verify Before Coding

Your training data for Convex is outdated. Before writing code:
- Read `convex/_generated/ai/guidelines.md` first
- Read `convex/schema.ts` for local schema and indexes
- Use Convex MCP tools (`tables`, `functionSpec`) to verify live deployment state
- Use official Convex docs or Context7 when unsure of API usage

## Structure Contract

Follow these rules so we do not recreate god files:
- Keep registered Convex exports in feature modules (e.g. `convex/events/*.ts`, `convex/stripe/*.ts`, `convex/payments/*.ts`)
- Do not add new domain API files at the Convex root. Create or extend a feature folder instead.
- Keep top-level API files thin: registration, auth, argument validation, return validation, and orchestration only
- Do not put large helper blocks, validator catalogs, read-model builders, or pricing/refund math in top-level API files
- Put domain-only logic in `convex/lib/<domain>/**` or `convex/<feature>/_impl/**`
- Put shared cross-domain utilities in `convex/lib/**`
- Do not import one registered-function module from another registered-function module
- Do not import another feature's `/_impl/**` (private implementation). The ESLint rules enforce this.
- Repeated literal unions and return-shape fragments must be centralized instead of redefined across files
- Provider-specific payment helpers belong in `convex/lib/stripe.ts`
- When a top-level file starts mixing multiple concerns, extract before it becomes a god file
- Use `takeFromQuery(...)` for bounded async-iterable reads and `collectAllQueryUnsafe(...)` only for deliberate full scans
- If a full scan remains necessary, keep it in a helper with a comment explaining why an exact full read is required

## Convex-Specific Rules

- All public-facing endpoints use bare `query()` / `mutation()` with handler-level auth checks
- Authorization has three layers: `convex/lib/authz.ts` (role/relation state), `convex/lib/access.ts` (all authorization decisions), and handlers (call access.ts only)
- Auth composition rule: use `requireUser(ctx)` to resolve the caller, then pass the caller id to access checks (`requireX` / `canX`). Prefer `const {_id: callerId} = await requireUser(ctx);` when only the id is needed. Keep new feature code on this direct composition pattern instead of adding wrapper helper surfaces.
- Feature code imports `convex/lib/access.ts` for all `can*` and `require*` authorization checks — never `authz.ts` directly for access decisions
- Access module functions use verb-first naming: `canViewEvent`, `requireViewEvent`, `canEditEvent`, `requireEditEvent`. Follow this convention when adding new access functions.
- Only `convex/lib/authz.ts` may call `components.authz.*`; only authz-management modules (membership, magic links, admin invites) may call `addMember`/`removeMember`/`grantRole`/`revokeRole`
- Enumeration helpers (`listOrganizerMembers`, `listCommunityAdminIds`, `getCommunityMembers`, `getUserCommunities`) in `authz.ts` are data queries, not authorization decisions — direct import is permitted
- Visibility helpers (`isPubliclyVisible`, `isOpenAccess`) live in `convex/lib/access.ts`. Read-model code may import these directly from `access.ts` for filtering and display purposes.
- Do not inline visibility checks, permission checks, or trust resolution in handlers — use the matching `access.ts` function
- Internal-only code should continue to use `internalQuery` / `internalMutation` where appropriate
- Always define argument validators for every function
- Keep return validators explicit and reuse shared validator primitives when possible
- Prefer indexed queries with `withIndex(...)`; avoid `.filter((q) => ...)`
- Use `v.null()` instead of relying on `undefined`
- Keep TypeScript strict and never use `any`

## PII Handling

Use `logger` from `convex/lib/logger.ts` for backend logging.
Do not use raw `console.log/info/warn/error` in Convex runtime code.
The logger sanitizes sensitive keys and common PII patterns in free-form strings
(email, phone, SSN, card-like values).

## Testing

Tests live in `convex/**/*.test.ts` (edge-runtime environment).
Use `convexTest()`, `t.run()`, `t.mutation()`, and `t.query()` rather than Playwright.
Backend logic tests do not belong in `frontend/e2e/`.
Run targeted backend checks while iterating:
- `pnpm typecheck:convex`
- `pnpm lint:convex`
- `pnpm test:convex`

## Test Data Maintenance

When you modify `convex/schema.ts` or any validator file in `convex/lib/validators/`
or `convex/lib/**/validators.ts`, check whether test seed data needs updating.

See `backend/convex/testing/AGENTS.md` for the full patterns. Seed helpers live in
`convex/testing/**` (the `api.testing.*` namespace) and should be updated in the same
change when schema/validator changes affect required fields or enum vocabularies.

## Debugging

Use Convex MCP tools:
- `data` to inspect live data
- `runOneoffQuery` to test queries safely
- `logs` to debug execution issues
