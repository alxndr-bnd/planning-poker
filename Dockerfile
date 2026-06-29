# ---- build stage: install deps & build the SPA ----
FROM node:24-slim AS build
WORKDIR /app

# Install with workspace package manifests first (better layer caching).
# npm ci = reproducible, lockfile-pinned install (vs npm install).
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci

# Copy sources and build the client bundle.
COPY . .
RUN npm run build   # -> client/dist

# ---- runtime stage: Node serving SPA + WebSocket via tsx ----
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    STATIC_DIR=/app/client/dist

# Patch base-image OS packages, then strip npm/npx/corepack: the runtime starts the
# server straight from the local tsx binary and never needs them. Removing them drops
# their bundled deps (e.g. npm's undici, CVE-2026-12151) from the image and shrinks the
# attack surface — keeps the Trivy deploy gate green.
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/* && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

# Bring the whole built workspace (incl. node_modules with the @pp/shared symlink and tsx).
# Owned by the built-in non-root `node` user so it can read/write (e.g. tsx cache).
COPY --from=build --chown=node:node /app /app

# Drop root — run the server as the unprivileged `node` user (defense in depth).
USER node

EXPOSE 8080
# tsx runs the TypeScript server directly (resolves workspace + .ts sources). Invoked via
# the local tsx binary instead of `npx` since npm was removed from the runtime above.
CMD ["node_modules/.bin/tsx", "server/src/index.ts"]
