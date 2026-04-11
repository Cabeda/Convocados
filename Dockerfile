FROM node:22-alpine AS base

RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# ── deps (all, for build) ─────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# ── prod-deps (no devDependencies) ───────────────────────────────────────────
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod

# ── build ─────────────────────────────────────────────────────────────────────
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
RUN pnpm run build

# ── production ────────────────────────────────────────────────────────────────
FROM base AS production
ENV NODE_ENV=production

# Install Litestream for continuous SQLite replication to S3/R2
ADD https://github.com/benbjohnson/litestream/releases/download/v0.5.11/litestream-v0.5.11-linux-amd64.tar.gz /tmp/litestream.tar.gz
RUN tar -C /usr/local/bin -xzf /tmp/litestream.tar.gz && rm /tmp/litestream.tar.gz

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY --from=build /app/node_modules/@prisma/engines ./node_modules/@prisma/engines
RUN mkdir -p node_modules/.bin && ln -sf ../prisma/build/index.js node_modules/.bin/prisma
COPY package.json ./
COPY prisma ./prisma
COPY public ./public
COPY litestream.yml ./litestream.yml
COPY scripts/start.sh ./scripts/start.sh

EXPOSE 3000
CMD ["sh", "./scripts/start.sh"]
