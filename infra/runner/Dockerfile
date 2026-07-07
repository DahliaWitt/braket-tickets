# Custom GitHub Actions runner image with pre-baked CI tooling.
# Based on myoung34/github-runner with Node.js, pnpm, Playwright browsers,
# and just pre-installed. Eliminates ~2-3min of per-job setup overhead.
#
# Build:
#   docker build -t braket-runner:latest infra/runner/
#
# Rebuild when:
#   - Playwright version bumps (check pnpm-lock.yaml)
#   - Node.js version changes (keep in sync with .nvmrc)
#   - pnpm major version changes
#
# Node.js floor: Angular 22 requires Node >=22.22.3 (see .nvmrc). CI/deploy
# workflows install the .nvmrc version via actions/setup-node and prepend it to
# PATH, so a lagging pre-baked Node here is non-blocking — but rebuild this image
# so the baked-in Node matches .nvmrc and avoids the per-job install overhead.
#
# Tag convention: braket-runner:<playwright-version>
#   docker build -t braket-runner:1.59.1 --build-arg PLAYWRIGHT_VERSION=1.59.1 infra/runner/

FROM myoung34/github-runner:ubuntu-noble

# Avoid interactive prompts during apt installs
ENV DEBIAN_FRONTEND=noninteractive

# --- Node.js 22 ---
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    npm cache clean --force

# --- pnpm (corepack) ---
RUN corepack enable && corepack prepare pnpm@latest --activate

# --- Playwright browsers + system deps ---
# Must match the version in pnpm-lock.yaml
ARG PLAYWRIGHT_VERSION=1.59.1
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
RUN npx playwright@${PLAYWRIGHT_VERSION} install --with-deps chromium webkit && \
    rm -rf /tmp/* /root/.npm

# --- just (command runner) ---
RUN curl --proto '=https' --tlsv1.2 -sSf https://just.systems/install.sh | \
    bash -s -- --to /usr/local/bin

# --- Cleanup ---
RUN apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# NOTE: No USER directive here. The myoung34/github-runner entrypoint
# requires root to register/deregister the runner and configure
# permissions. It drops to a non-root "runner" user internally.
