# Compute Engine Attempt (May 2026)

Documented an attempt to move the render worker from Cloud Run to a Compute Engine VM with GPU. Ultimately decided to stay on Cloud Run for simplicity (no server management).

## Motivation

- Cloud Run doesn't expose `/dev/dri/` (DRM device nodes), so Chrome can't use VA-API hardware video encoding — WebCodecs `VideoEncoder` falls back to CPU-based encoding
- Wanted to test if NVENC hardware encoding would significantly speed up renders

## What was set up

### VM creation

```bash
gcloud compute instances create render-worker-test \
  --project=recordio-484905 \
  --zone=us-east4-b \
  --machine-type=g2-standard-8 \
  --accelerator=type=nvidia-l4,count=1 \
  --maintenance-policy=TERMINATE \
  --image-family=common-cu129-ubuntu-2204-nvidia-580 \
  --image-project=deeplearning-platform-release \
  --boot-disk-size=50GB \
  --scopes=cloud-platform \
  --provisioning-model=SPOT
```

Used `g2-standard-8` with NVIDIA L4 GPU. The `common-cu129-ubuntu-2204-nvidia-580` image comes with NVIDIA drivers and CUDA pre-installed. (Note: this VM got a T4 not an L4, depends on zone availability.)

### Dependencies installed

```bash
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Playwright Chromium + system deps
sudo npx playwright install --with-deps chromium

# GPU video encode/decode + rendering libs
sudo apt-get install -y ffmpeg libegl1 libgles2 libvulkan1 vulkan-tools \
  libva2 libva-drm2 vainfo libnvidia-gl-580-server \
  libnvidia-decode-580-server libnvidia-encode-580-server
```

### Fix Chrome's bundled SwiftShader

Playwright's Chromium bundles SwiftShader (CPU Vulkan) next to the binary. Chrome finds it first and ignores the real NVIDIA driver. Fix:

```bash
CHROME_DIR=$(find /root/.cache/ms-playwright -name chrome-linux64 -type d | head -1)

# Replace SwiftShader ICD with NVIDIA ICD
cat > "$CHROME_DIR/vk_swiftshader_icd.json" <<'EOF'
{"file_format_version":"1.0.0","ICD":{"library_path":"/usr/lib/x86_64-linux-gnu/libGLX_nvidia.so.0","api_version":"1.4.312"}}
EOF

# Remove SwiftShader lib
mv "$CHROME_DIR/libvk_swiftshader.so" "$CHROME_DIR/libvk_swiftshader.so.bak"
```

### Deploying code

Code was manually scp'd to `/opt/render-worker/` and run directly:

```bash
RENDER_SECRET=$(gcloud secrets versions access latest --secret=render-secret --project=recordio-484905)
sudo HOME=/root RENDER_SECRET="$RENDER_SECRET" NODE_ENV=production PORT=8080 \
  nohup node /opt/render-worker/dist/server.js > /tmp/render.log 2>&1 &
```

### Firewall rule

```bash
gcloud compute firewall-rules create allow-render-8080 \
  --project=recordio-484905 \
  --allow=tcp:8080 \
  --target-tags=render-worker \
  --source-ranges=0.0.0.0/0
```

### nvidia-vaapi-driver (for hardware encode)

Built from source to bridge VA-API → NVENC:

```bash
sudo apt-get install -y meson libva-dev libegl-dev libgstreamer-plugins-bad1.0-dev git
cd /tmp && git clone https://github.com/elFarto/nvidia-vaapi-driver.git
cd nvidia-vaapi-driver && meson setup build && cd build && ninja && sudo ninja install
```

Also needed `nvidia_drm.modeset=1`:

```bash
echo 'options nvidia-drm modeset=1' | sudo tee /etc/modprobe.d/nvidia-drm-modeset.conf
sudo update-initramfs -u
# reboot required
```

## Findings

### What worked

- **GPU canvas rendering**: confirmed working via Vulkan — `ANGLE (NVIDIA, Vulkan 1.4.312 (NVIDIA Tesla T4))`
- **Hardware video decoding**: confirmed — `Decoder ready (hardware)` via NVDEC
- **Render performance**: ~10ms/frame for 1080p, similar to Cloud Run with L4

### What didn't work: hardware video encoding

- `nvidia-vaapi-driver` only exposes **decode** (VLD) entrypoints via VA-API, not encode (EncSlice)
- Chrome's WebCodecs `prefer-hardware` on Linux only checks VA-API for encode — no VA-API encode path = no NVENC
- The T4 has NVENC hardware but Chrome can't access it through any current API
- Encoding stayed CPU-based: `Encoder HW accel for avc1.64002a: false`
- The "backpressure" metric in frame logs (~125-175ms per 30 frames) IS the real encode cost

### Performance numbers (4555 frames, 1080p, H.264 High + Opus)

| Per 30-frame batch | Time |
|----|------|
| decode | 4-48ms (hardware, varies with keyframe distance) |
| render (canvas) | 130-142ms (~4.5ms/frame, GPU) |
| encode submit | 1-2ms (just queue submission) |
| backpressure | 123-175ms (actual CPU encode time) |
| total | 270-333ms (~10ms/frame) |

Total render: ~65.8s including upload for a 30s video at 1080p.

### Conclusion

The VM gives hardware decode and GPU canvas rendering (same as Cloud Run), but doesn't unlock hardware encoding — which was the main motivation. The complexity of managing a VM (no auto-scaling, manual deploys, firewall rules, process management) isn't worth it without the encode benefit.

Potential future path: use FFmpeg with `h264_nvenc` as a post-processing step after WebCodecs produces a lossless/quick encode. But this adds pipeline complexity.

## Resources to clean up

- VM: `render-worker-test` in `us-east4-b` (SPOT instance)
- Firewall rule: `allow-render-8080`
- Supabase env var `RENDER_WORKER_URL` should point back to Cloud Run URL
