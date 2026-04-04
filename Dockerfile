FROM node:22-alpine AS base

RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# ── deps (all, for build) ─────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# Create minimal mobile workspace stub so pnpm can resolve the lockfile
RUN mkdir -p mobile && echo '{"name":"convocados-mobile","version":"0.0.0","private":true}' > mobile/package.json
RUN pnpm install --frozen-lockfile

# ── prod-deps (no devDependencies) ───────────────────────────────────────────
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN mkdir -p mobile && echo '{"name":"convocados-mobile","version":"0.0.0","private":true}' > mobile/package.json
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

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY --from=build /app/node_modules/@prisma/engines ./node_modules/@prisma/engines
RUN mkdir -p node_modules/.bin && ln -sf ../prisma/build/index.js node_modules/.bin/prisma
COPY package.json ./
COPY prisma ./prisma
COPY public ./public
COPY scripts/start.sh ./scripts/start.sh

EXPOSE 3000
CMD ["sh", "./scripts/start.sh"]
