# ---- build stage: install deps & build the SPA ----
FROM node:22-slim AS build
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
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    STATIC_DIR=/app/client/dist

# Bring the whole built workspace (incl. node_modules with the @pp/shared symlink and tsx).
# Owned by the built-in non-root `node` user so it can read/write (e.g. tsx cache).
COPY --from=build --chown=node:node /app /app

# Drop root — run the server as the unprivileged `node` user (defense in depth).
USER node

EXPOSE 8080
# tsx runs the TypeScript server directly (resolves workspace + .ts sources).
CMD ["npx", "tsx", "server/src/index.ts"]
