# ---- build stage: install deps & build the SPA ----
FROM node:25-slim AS build
WORKDIR /app

# Install with workspace package manifests first (better layer caching).
# npm ci = reproducible, lockfile-pinned install (vs npm install).
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci

# Copy sources and build: client SPA (-> client/dist) + server bundle
# (-> server/dist/index.js, a single ESM file via esbuild).
COPY . .
RUN npm run build

# ---- runtime stage: Node serving the SPA + WebSocket from the precompiled bundle ----
FROM node:25-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    STATIC_DIR=/app/client/dist

# Patch base-image OS packages, then strip npm/npx/corepack: the runtime runs a single
# precompiled `node` bundle and never needs them. Removing them drops their bundled deps
# (e.g. npm's undici) and shrinks the attack surface — keeps the Trivy deploy gate green.
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/* && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

# Copy ONLY the built artifacts — the precompiled server bundle and the SPA. No
# node_modules, so tsx/esbuild (and their Go/native binaries, e.g. esbuild's Go stdlib
# CVE-2026-39822) never reach the runtime image. @pp/shared + ws are inlined in the bundle.
COPY --from=build --chown=node:node /app/server/dist /app/server/dist
COPY --from=build --chown=node:node /app/client/dist /app/client/dist

# Drop root — run the server as the unprivileged `node` user (defense in depth).
USER node

EXPOSE 8080
# Run the precompiled server bundle directly with the Node runtime.
CMD ["node", "server/dist/index.js"]
