FROM node:22-bookworm-slim AS builder

ENV CI=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@9.15.9

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @nudge/shared build \
 && pnpm --filter @nudge/server build \
 && pnpm --filter @nudge/web build \
 && mkdir -p packages/server/dist/migrations \
 && cp packages/server/src/migrations/*.sql packages/server/dist/migrations/

FROM builder AS app

ENV NODE_ENV=production \
    PORT=8787 \
    DB_PATH=/data/nudge.db \
    NUDGE_SCHEDULER=on

VOLUME ["/data"]
EXPOSE 8787
WORKDIR /app
CMD ["node", "packages/server/dist/main.js"]

FROM caddy:2-alpine AS web

COPY --from=builder /app/packages/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
