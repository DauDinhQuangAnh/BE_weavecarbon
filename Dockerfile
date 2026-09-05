# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
COPY migrations ./migrations
COPY templates ./templates
COPY scripts/migrate.js ./scripts/migrate.js
# npm is required only in the dependency stage. Keeping it in the production
# image adds an unused package manager and its transitive vulnerability surface.
RUN rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx \
    && mkdir -p uploads \
    && chown -R node:node /app

USER node

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 CMD wget -qO- "http://127.0.0.1:${PORT}/ready" >/dev/null 2>&1 || exit 1

CMD ["sh", "-c", "node scripts/migrate.js && node src/server.js"]
