---
globs: frontend/scripts/*.ts, backend/scripts/sync-env.ts, scripts/with-env.ts, scripts/e2e*.ts, frontend/src/types/braket-runtime.d.ts
---

# Environment Variable Rules

## Source of Truth

Braket Tickets uses Doppler for project environment configuration. Do not add,
document, or rely on committed `.env` files for normal development, test, E2E,
staging, or production workflows.

## Rules

- Use the repo package scripts, which apply the expected Doppler/runtime wrappers.
- Do not wrap commands that already inject Doppler, including `pnpm dev`, `pnpm test:frontend`, `pnpm test:e2e*`, `pnpm lint:angular`, and `pnpm validate`.
- Raw Convex CLI commands that require environment variables need an explicit Doppler wrapper.
- Do not hand-edit generated frontend runtime outputs; the source of truth is `frontend/scripts/runtime-config.ts`.
- Do not edit `frontend/src/types/braket-runtime.d.ts` unless the runtime contract itself changes.
- E2E runtime values are passed through `frontend/scripts/run-ng-with-runtime.ts`; do not create local env files for E2E.
- `CONVEX_DEPLOY_KEY` is CI-only. Never store it locally or in repo context.
