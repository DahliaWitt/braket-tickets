FROM node:24-alpine

WORKDIR /app

COPY package.json /app/package.json

# Install the Convex CLI at the exact version declared in the workspace root
# manifest (range prefix stripped), so the image can never drift from the app
# and Dependabot's convex group keeps it current.
RUN npm install --global "convex@$(node -p 'const d=require("/app/package.json"); ((d.dependencies||{}).convex||(d.devDependencies||{}).convex).replace(/^[~^]/,"")')"

# Create non-root user for runtime
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY convex.json /app/convex.json
COPY ops/convex-log-forwarder.mjs /app/scripts/convex-log-forwarder.mjs
COPY ops/convex-backup.sh /app/scripts/convex-backup.sh
COPY shared/log-sanitizer.mjs /app/shared/log-sanitizer.mjs

RUN chmod +x /app/scripts/convex-backup.sh && \
    chown -R appuser:appgroup /app

USER appuser
