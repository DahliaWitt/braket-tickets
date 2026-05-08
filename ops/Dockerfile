FROM node:22-alpine

RUN npm install --global convex@1.31.4

# Create non-root user for runtime
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY package.json /app/package.json
COPY convex.json /app/convex.json
COPY ops/convex-log-forwarder.mjs /app/scripts/convex-log-forwarder.mjs
COPY ops/convex-backup.sh /app/scripts/convex-backup.sh
COPY shared/log-sanitizer.mjs /app/shared/log-sanitizer.mjs

RUN chmod +x /app/scripts/convex-backup.sh && \
    chown -R appuser:appgroup /app

USER appuser
