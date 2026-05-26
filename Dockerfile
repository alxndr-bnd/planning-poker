# ---- build stage: install deps & build the SPA ----
FROM node:22-slim AS build
WORKDIR /app

# Install with workspace package manifests first (better layer caching).
COPY package.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN npm install

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
COPY --from=build /app /app

EXPOSE 8080
# tsx runs the TypeScript server directly (resolves workspace + .ts sources).
CMD ["npx", "tsx", "server/src/index.ts"]
