# check=skip=SecretsUsedInArgOrEnv;error=true
# Build checks fail the build (error=true). The one skipped rule flags ARG CF_BEACON_TOKEN by
# its name only: the value is the public Cloudflare Web Analytics site id that every page
# ships in its HTML, not a secret (see the ARG below).
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

# Copy sources and build: client SPA (-> client/dist) + server bundle
# (-> server/dist/index.js, a single ESM file via esbuild).
COPY . .
# Optional analytics for the built pages (SERBITO-513; client/src/pageAnalytics.ts). Empty:
# no GA4 tag, no cookie banner, no Cloudflare beacon. Both values are public page ids, not
# secrets; deploy.yml passes the live site's.
ARG GA_MEASUREMENT_ID=""
ARG CF_BEACON_TOKEN=""
RUN npm run build

# ---- runtime stage: Node serving the SPA + WebSocket from the precompiled bundle ----
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    STATIC_DIR=/app/client/dist

# Patch base-image OS packages, then strip npm/npx/corepack: the runtime runs a single
# precompiled `node` bundle and never needs them. Removing them drops their bundled deps
# (e.g. npm's undici) and shrinks the attack surface — keeps the Trivy deploy gate green.
# APT_REFRESH is the UTC date (deploy.yml passes it): the RUN reads it, so each day's first
# build re-runs the upgrade instead of reusing a stale cached layer (SERBITO-369).
ARG APT_REFRESH
RUN echo "apt refresh: ${APT_REFRESH:-unset}" && \
    apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/* && \
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
