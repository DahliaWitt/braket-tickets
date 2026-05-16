---
title: E2E Environment Setup
category: Testing
categoryOrder: 3
order: 1
description: How Convex URLs are injected into the Angular frontend during E2E testing
access: public
---

# E2E Environment Setup

How the Angular frontend connects to the correct Convex backend during E2E testing — and why you can run `pnpm start` and `pnpm test:e2e:serve` at the same time without conflicts.

## The Problem

When running E2E tests, the Convex backend starts on **ephemeral ports** (randomly assigned by the OS). The Angular frontend needs to know these ports to connect via WebSocket and HTTP.

Previously, the ports were written into shared frontend config artifacts. This caused issues:

- If the backend restarted on a new port, the frontend still had the old port cached
- Running `pnpm start` (dev server) alongside `pnpm test:e2e:serve` would overwrite each other's environment files
- Shared source-tree writes made Angular's cache less effective

## The Solution: Build-Time Define Injection

E2E now uses the same typed runtime-config builder as every other frontend command. The harness provides `CONVEX_URL` and `CONVEX_SITE_URL`, and the Angular wrapper injects them with `--define` when that specific `ng serve` or `ng build` process starts.

### How It Works

```
┌─────────────────────────────────────────────────────┐
│  Harness starts Angular                             │
│  ┌───────────────────────────────────────────────┐  │
│  │ scripts/run-ng-with-runtime.ts                │  │
│  │   → resolves mode=e2e                         │  │
│  │   → injects __BRAKET_RUNTIME__ via --define   │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │ Angular bootstraps                            │  │
│  │   → environment.ts reads __BRAKET_RUNTIME__   │  │
│  │   → ConvexService connects to correct port    │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

1. **`scripts/lib/AngularFrontend.ts`** sets `CONVEX_URL` and `CONVEX_SITE_URL` for that serve/build process
2. **`frontend/scripts/run-ng-with-runtime.ts`** converts those values into Angular `--define` arguments
3. **`frontend/src/environments/environment.ts`** reads the injected `__BRAKET_RUNTIME__` object, falling back to a stable local default when no define is present

### Why This Solves Concurrency

There is no longer any mutable shared frontend config file:

| Mode                    | Mechanism             | How URLs Stay Fresh                                                              |
| ----------------------- | --------------------- | -------------------------------------------------------------------------------- |
| `ng serve` (dev server) | **Build-time define** | The harness starts one Angular process with one stable pair of Convex URLs.      |
| `--build` (CI / prod)   | **Build-time define** | The build process receives its own env vars and bakes them into that build only. |

## Key Files

| File                                       | Role                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `frontend/scripts/runtime-config.ts`       | Builds the public frontend config object for each mode.                              |
| `frontend/scripts/run-ng-with-runtime.ts`  | Injects the config into Angular with `--define`.                                     |
| `frontend/src/environments/environment.ts` | Reads `__BRAKET_RUNTIME__`, with a stable fallback for raw TypeScript/lint contexts. |
| `scripts/lib/AngularFrontend.ts`           | Starts Angular with harness-specific `CONVEX_URL` / `CONVEX_SITE_URL` values.        |
| `scripts/e2e-run.ts`                       | Reuses the running server; it no longer rewrites frontend assets.                    |

## Running Dev and E2E Simultaneously

You can safely run both servers from the same source tree:

```bash
# Terminal 1: Dev server for manual testing
pnpm start

# Terminal 2: E2E server with ephemeral Convex backend
pnpm test:e2e:serve

# Terminal 3: Run E2E tests
pnpm test:e2e:run --grep "my test"
```

**Why this works:**

- `pnpm start` starts one Angular process with one define-injected config object
- `pnpm test:e2e:serve` starts a separate Angular process with a different define-injected config object
- Neither command rewrites `frontend/src` or `frontend/public`
- Different worktrees stay isolated because each worktree has its own source tree and its own Angular cache

## Hot Deploying Backend Changes

When you hot-deploy Convex functions:

```bash
pnpm convex deploy --admin-key <key> --url "$(cat .convex-local/.e2e-convex-url)"
```

No frontend restart is needed. The URLs haven't changed — only the backend functions were updated. The next `page.goto()` in your tests will connect to the same ephemeral port with the updated functions.

## Troubleshooting

### Tests connect to port 3210 instead of the ephemeral port

If your tests connect to `127.0.0.1:3210` instead of the harness-selected port:

1. Check `.convex-local/e2e-active/convex-url` and `.convex-local/e2e-active/convex-site-url`
2. Restart `pnpm test:e2e:serve` so Angular gets a fresh define-injected config
3. If using `--build` mode, rebuild so the static bundle is regenerated with the current harness URLs
