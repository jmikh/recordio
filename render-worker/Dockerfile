# ── Stage 1: Build render page (Vite) ─────────────────────────
# Needs: shared/, webapp/public/ (WASM files), render-worker/render-page/
# No longer needs webapp/src/ — ExportManager is now in shared/
FROM node:22-slim AS render-page-builder
WORKDIR /build

# Install root deps (render-page uses shared libs like mp4-muxer, soundtouchjs)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy sources needed for Vite build
COPY shared/ shared/
COPY webapp/public/ webapp/public/
COPY render-worker/render-page/ render-worker/render-page/

RUN cd render-worker/render-page && npx vite build

# ── Stage 2: Build worker (tsup) ──────────────────────────────
FROM node:22-slim AS worker-builder
WORKDIR /build

COPY render-worker/package.json render-worker/package-lock.json render-worker/
COPY render-worker/tsup.config.ts render-worker/
COPY render-worker/tsconfig.json render-worker/
COPY render-worker/src/ render-worker/src/
COPY shared/ shared/

RUN cd render-worker && npm ci && npx tsup

# ── Stage 3: Production runtime ───────────────────────────────
FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /app

# Copy built artifacts
COPY --from=worker-builder /build/render-worker/dist/ ./dist/
COPY --from=worker-builder /build/render-worker/node_modules/ ./node_modules/
COPY --from=render-page-builder /build/render-worker/render-page/dist/ ./render-page/dist/
COPY render-worker/package.json ./

# Install only Chromium browser (skip Firefox/WebKit)
RUN npx playwright install chromium

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080
CMD ["node", "dist/server.js"]
