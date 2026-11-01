# Build from the repository root: docker build -f apps/api/Dockerfile .
# Targets: the default (last) stage is the API; `--target migrator` is the one-shot release job
# that applies migrations with DIRECT_DATABASE_URL (docs/operations.md).
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @mboka/api --workspace @mboka/shared --include-workspace-root=false
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @mboka/shared && npm run build -w @mboka/api

# Keeps the Prisma CLI (a dev dependency), so it is a separate image from the API.
FROM build AS migrator
WORKDIR /repo/apps/api
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

FROM build AS prune
RUN npm prune --omit=dev --workspace @mboka/api --workspace @mboka/shared

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=prune /repo/node_modules node_modules
COPY --from=prune /repo/packages/shared/package.json packages/shared/package.json
COPY --from=prune /repo/packages/shared/dist packages/shared/dist
COPY --from=prune /repo/apps/api/package.json apps/api/package.json
COPY --from=prune /repo/apps/api/dist apps/api/dist
COPY --from=prune /repo/apps/api/prisma apps/api/prisma
WORKDIR /repo/apps/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/api/v1/health/live || exit 1
# Migrations are a separate release step (the migrator target), never run at boot.
CMD ["node", "dist/main.js"]
