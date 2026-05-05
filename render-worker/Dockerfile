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

# Install ffmpeg, EGL/Vulkan libs for GPU support, VA-API NVENC bridge, and Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libegl1 \
    libgles2 \
    libvulkan1 \
    vulkan-tools \
    libva2 \
    libva-drm2 \
    vainfo \
    nvidia-vaapi-driver \
    && rm -rf /var/lib/apt/lists/*
RUN npx playwright install chromium

# Create NVIDIA ICD discovery files so GLVND + Vulkan loader find the GPU drivers
# Cloud Run mounts driver .so files at /usr/local/nvidia/lib64 but doesn't create these configs
RUN mkdir -p /usr/share/glvnd/egl_vendor.d /usr/share/vulkan/icd.d \
    && echo '{"file_format_version":"1.0.0","ICD":{"library_path":"/usr/local/nvidia/lib64/libEGL_nvidia.so.0"}}' \
       > /usr/share/glvnd/egl_vendor.d/10_nvidia.json \
    && echo '{"file_format_version":"1.0.0","ICD":{"library_path":"/usr/local/nvidia/lib64/libGLX_nvidia.so.0","api_version":"1.3"}}' \
       > /usr/share/vulkan/icd.d/nvidia_icd.json

# Ensure NVIDIA EGL vendor is discoverable (Cloud Run mounts drivers at /usr/local/nvidia)
ENV NVIDIA_DRIVER_CAPABILITIES=graphics,utility,compute,video
ENV NVIDIA_VISIBLE_DEVICES=all
ENV LIBVA_DRIVER_NAME=nvidia
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080
CMD ["node", "dist/server.js"]
