# Builds and runs zatlan-backend for Cloud Run. Build context is the repo root
# (not backend/) because this is a pnpm workspace — the backend depends on
# packages/shared-types via "workspace:*", so pnpm needs the whole workspace
# to resolve it. Deploy with the repo root as source, e.g.:
#   gcloud run deploy zatlan-backend --source . --region <region>
#
# The runtime stage keeps the same backend/ nesting the build stage produces
# (rather than flattening dist/ up to /app) specifically so pnpm's relative
# symlinks in backend/node_modules (pointing back up into the shared
# node_modules/.pnpm store) keep resolving correctly, and so Node finds
# backend/package.json's "type": "module" from the same directory as the
# compiled output.

FROM node:22-alpine AS build
WORKDIR /app

# Match the pnpm version pinned in pnpm-lock.yaml for a reproducible install.
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate

# Copy just the manifests first so this layer is cached across source-only
# changes — installing here reruns only when a package.json/lockfile changes.
# --filter zatlan-backend... (the "..." pulls in its workspace deps, i.e.
# shared-types) skips installing the frontend workspace's much larger,
# unrelated dependency tree (React, Vite, Tailwind, ...) entirely.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY backend/package.json backend/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN pnpm install --frozen-lockfile --filter zatlan-backend...

# Now the actual source, and build just the backend workspace. shared-types
# has no build step of its own (its package.json points straight at .ts
# source) — every backend import from it is `import type`, which TypeScript
# erases entirely at compile time, so it contributes nothing to dist/ output.
COPY backend backend
COPY packages/shared-types packages/shared-types
RUN pnpm --filter zatlan-backend run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Cloud Run injects its own PORT at runtime and expects the container to
# listen on it — this default only matters for `docker run` outside Cloud Run.
ENV PORT=8080

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist

EXPOSE 8080
CMD ["node", "backend/dist/index.js"]
