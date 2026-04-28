# Render Worker

Server-side video render worker using Playwright headless Chromium with WebCodecs. Deployed on Google Cloud Run with NVIDIA L4 GPU.

## GPU Setup (Cloud Run + Headless Chrome)

Getting Chromium to actually use the GPU on Cloud Run required solving several layers of issues. This documents what's needed and why.

### The Problem

Cloud Run GPU instances provide CUDA compute access (`nvidia-smi` works) but do NOT expose DRM graphics device nodes (`/dev/dri/`). Chromium normally requires `/dev/dri/renderD128` for GPU-accelerated rendering via EGL. Without it, Chrome silently falls back to SwiftShader (software rendering), making canvas operations ~15x slower.

### The Solution

Use ANGLE's **Vulkan backend** instead of EGL. NVIDIA's Vulkan ICD works through `/dev/nvidia0` (compute device) and doesn't need `/dev/dri/`.

#### 1. Dockerfile: Install GPU libraries + create ICD discovery files

Cloud Run mounts NVIDIA driver `.so` files at `/usr/local/nvidia/lib64/` but doesn't create the JSON config files that GLVND and the Vulkan loader need to discover them.

```dockerfile
# GPU userspace libraries
RUN apt-get install -y libegl1 libgles2 libvulkan1

# Create ICD discovery files (Cloud Run doesn't provide these)
RUN mkdir -p /usr/share/glvnd/egl_vendor.d /usr/share/vulkan/icd.d \
    && echo '{"file_format_version":"1.0.0","ICD":{"library_path":"/usr/local/nvidia/lib64/libEGL_nvidia.so.0"}}' \
       > /usr/share/glvnd/egl_vendor.d/10_nvidia.json \
    && echo '{"file_format_version":"1.0.0","ICD":{"library_path":"/usr/local/nvidia/lib64/libGLX_nvidia.so.0","api_version":"1.3"}}' \
       > /usr/share/vulkan/icd.d/nvidia_icd.json

# NVIDIA env vars so the container runtime exposes GPU capabilities
ENV NVIDIA_DRIVER_CAPABILITIES=graphics,utility,compute
ENV NVIDIA_VISIBLE_DEVICES=all
```

#### 2. Chrome flags: Vulkan + disable GPU sandbox

```typescript
chromium.launch({
    headless: false, // required for --headless=new
    args: [
        '--headless=new',           // new headless mode (uses full rendering pipeline)
        '--use-angle=vulkan',       // ANGLE uses Vulkan backend (works without /dev/dri)
        '--enable-features=Vulkan',
        '--disable-vulkan-surface', // offscreen rendering via bit-blit, no swapchain needed
        '--enable-gpu-rasterization',
        '--ignore-gpu-blocklist',   // L4 may not be in Chrome's allowlist
        '--disable-gpu-sandbox',    // GPU sandbox blocks /dev/nvidia* access
        '--in-process-gpu',         // avoids GPU process sandbox entirely
        '--no-sandbox',
    ],
});
```

**Critical flags explained:**
- `--use-angle=vulkan`: Routes rendering through Vulkan instead of EGL. This is the key flag — Vulkan works via `/dev/nvidia0` while EGL requires `/dev/dri/renderD128`.
- `--disable-vulkan-surface`: Tells Chrome to use bit-blit instead of a Vulkan swapchain, which would need a display/DRM device.
- `--disable-gpu-sandbox` + `--in-process-gpu`: Chrome's GPU process sandbox blocks access to `/dev/nvidia*` device files. Without these, Chrome silently falls back to SwiftShader even though `vulkaninfo` can see the GPU.
- `--ignore-gpu-blocklist`: The L4 GPU may not be in Chrome's known-good GPU list.

#### 3. Cloud Run deploy flags

```bash
gcloud run deploy render-worker \
    --gpu=1 --gpu-type=nvidia-l4 \
    --no-cpu-throttling \
    --cpu=8 --memory=32Gi
```

### How to verify GPU is working

Check these in the startup logs:
1. `nvidia-smi` should show `NVIDIA L4`
2. `vulkaninfo --summary` should show `deviceName = NVIDIA L4` with `PHYSICAL_DEVICE_TYPE_DISCRETE_GPU`
3. `/dev/nvidia0`, `/dev/nvidiactl`, `/dev/nvidia-uvm` should all exist
4. `/dev/dri/` will NOT exist — this is expected on Cloud Run
5. Render frame timing: `render=~7ms/frame` (GPU) vs `render=~110ms/frame` (SwiftShader)

### What doesn't work (and why)

| Approach | Why it fails on Cloud Run |
|----------|--------------------------|
| `--use-gl=egl` | Requires `/dev/dri/renderD128` which Cloud Run doesn't expose |
| `mknod /dev/dri/renderD128` | Cloud Run containers lack `CAP_MKNOD` capability |
| `modprobe nvidia-drm` | Kernel module loading blocked by gVisor runtime |
| `--no-sandbox` alone | Only disables renderer sandbox, not GPU process sandbox |

### Performance

| Metric | SwiftShader (CPU) | NVIDIA L4 (GPU) |
|--------|-------------------|------------------|
| Canvas drawImage (per frame) | ~110ms | ~7ms |
| 144-frame render (total) | ~17s render | ~1s render |
