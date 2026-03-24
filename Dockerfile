FROM node:22-alpine AS base

RUN apk add --no-cache openssl

WORKDIR /app

# ── deps (all, for build) ─────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ── prod-deps (no devDependencies) ───────────────────────────────────────────
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── build ─────────────────────────────────────────────────────────────────────
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# ── litestream ────────────────────────────────────────────────────────────────
FROM base AS litestream
ARG LITESTREAM_VERSION=v0.3.13
RUN wget -q "https://github.com/benbjohnson/litestream/releases/download/${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-amd64.tar.gz" \
      -O /tmp/litestream.tar.gz \
    && tar -xzf /tmp/litestream.tar.gz -C /usr/local/bin \
    && rm /tmp/litestream.tar.gz

# ── production ────────────────────────────────────────────────────────────────
FROM base AS production
ENV NODE_ENV=production

COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
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
