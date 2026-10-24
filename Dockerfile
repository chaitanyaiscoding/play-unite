# syntax=docker/dockerfile:1

# ---- Build the React client ------------------------------------------------
FROM node:24-alpine AS client
WORKDIR /app
COPY shared ./shared
COPY client/package.json client/package-lock.json ./client/
RUN npm ci --prefix client --no-audit --no-fund
COPY client ./client
RUN npm run build --prefix client

# ---- Server production dependencies ----------------------------------------
# --omit=optional skips mongodb-memory-server (the dev-only embedded MongoDB).
FROM node:24-alpine AS server-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --omit=optional --no-audit --no-fund

# ---- Runtime -----------------------------------------------------------------
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=5000
WORKDIR /app
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server/package.json ./server/
COPY server/src ./server/src
COPY shared ./shared
COPY --from=client /app/client/dist ./client/dist

USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5000/api/health >/dev/null || exit 1
CMD ["node", "server/src/index.js"]
