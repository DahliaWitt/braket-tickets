# Contributing to Braket Tickets

Braket is built by and for queer and trans communities. If that resonates with
you and you want to help make the platform better, we'd love to have you.

Bug fixes, accessibility improvements, documentation, new features — all
welcome. If you're unsure whether something is in scope, open an issue first
and we'll figure it out together.

This project is released under the
[Anti-Capitalist Software License (v 1.4)](LICENSE).

## Contributor license grant

By submitting a pull request or other contribution, you agree to the following:

1. **You have the right to contribute.** Your contribution is your original
   work, or you have sufficient rights to submit it under these terms.

2. **License grant to Braket LLC.** You grant to Braket LLC a perpetual,
   worldwide, non-exclusive, royalty-free, irrevocable license to use,
   reproduce, modify, prepare derivative works of, publicly display, publicly
   perform, sublicense, and distribute your contribution and any derivative
   works thereof. This includes the right to operate hosted instances of the
   Software that incorporate your contribution, including instances that charge
   fees for cost recovery, hosting, or maintenance — even where such use might
   not be permitted under the project's public license.

3. **Public license preserved.** Your contribution is also made available to
   the public under the project's
   [Anti-Capitalist Software License (v 1.4)](LICENSE). Nothing in this
   agreement restricts the rights granted to the public under that license.

### Why?

Braket LLC is a partnership LLC. We operate like a non-profit — the platform
fee covers hosting, development, and accounting, and that's it. We don't
generate profit.

But because we're technically an LLC running a hosted instance of this
software, the ACSL alone doesn't cleanly grant us the right to do that. This
grant closes the gap so we can keep running the canonical instance while your
contributions stay available to the public under the ACSL.

We'd rather be upfront about this than hide it in fine print. If you have
questions, open an issue.

## Getting started

### Prerequisites

- **Node.js 22+** — we recommend [nvm](https://github.com/nvm-sh/nvm) or
  [fnm](https://github.com/Schniz/fnm)
- **pnpm 9+** — install with `corepack enable` (ships with Node 22)
- **Docker** — only needed on Linux; macOS runs the local Convex backend
  natively
- **curl** and **unzip** — for automatic backend binary download (macOS has
  these by default)

### Setup

1. Fork the repo and clone your fork:
   ```bash
   git clone https://github.com/<your-username>/braket-tickets.git
   cd braket-tickets
   ```
2. Branch from `develop` (never `main`):
   ```bash
   git checkout -b my-feature develop
   ```
3. Install dependencies:
   ```bash
   pnpm install
   ```
4. Set up your environment. Two paths depending on whether you have
   [Doppler](https://www.doppler.com/) access:

   **With Doppler** (core team):

   ```bash
   doppler login
   pnpm dev
   ```

   **Without Doppler** (external contributors):

   ```bash
   cp .env.example .env.local
   set -a; source .env.local; set +a
   pnpm dev
   ```

   The template already has `DOPPLER_INJECTED=1` set, which is the only value
   strictly required to run `pnpm dev`. The dev harness generates safe defaults
   for database URLs, auth secrets, and CORS. Fill in additional credentials
   only for the features you're working on:

   | Credential | What it unlocks |
   | --- | --- |
   | Google/Discord OAuth | Social login (email/password still works without) |
   | Stripe test keys | Payment and checkout flows |
   | Ethereal SMTP | Email previews (get free credentials at [ethereal.email](https://ethereal.email/)) |
   | PostHog/Sentry | Analytics and error tracking (fully optional) |

   See [docs/environment.md](docs/environment.md) for details on each
   variable.

5. Seed demo data (in a second terminal, with env vars sourced):
   ```bash
   set -a; source .env.local; set +a   # skip if using Doppler
   pnpm seed:fresh
   ```

   This creates a root admin account, demo communities, events, and users so
   you have something to interact with immediately.

## Making changes

- Use [Conventional Commits](https://www.conventionalcommits.org/):
  `<type>(<scope>): <description>`
- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
  `chore`, `ci`, `build`
- Scopes: `frontend`, `convex`, `e2e`, `rls`, `docs`
- Write tests for new functionality
- Run validation before opening a PR: `./scripts/validate.sh all`

## Pull requests

- Target `develop`
- One logical change per PR
- Describe what changed and why
- CI checks need to pass before merge

## Code of conduct

Read and follow the [Code of Conduct](CODE_OF_CONDUCT.md). Short version:
don't be a jerk, respect people's identities, and remember that this
platform exists to protect community spaces.

## Questions?

Open an issue or email contact@braket.gay — we don't bite.
