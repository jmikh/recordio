/**
 * GPU diagnostics — logs driver, Vulkan, VA-API, and DRM state at startup.
 * Useful for debugging GPU rendering on Cloud Run with NVIDIA L4.
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import type { Page } from 'playwright';

// page.evaluate callbacks run in the browser, but TS compiles this as Node.
// Declare browser globals to avoid TS2584/TS2304 without adding 'dom' lib.
declare const document: any;
declare const navigator: any;

/** Log OS-level GPU driver and device state. Called once at startup. */
export function logGpuDiagnostics(): void {
    // NVIDIA driver libs
    const nvidiaPath = '/usr/local/nvidia/lib64';
    console.log(`[Render] NVIDIA driver path exists: ${fs.existsSync(nvidiaPath)}`);
    if (fs.existsSync(nvidiaPath)) {
        const allLibs = fs.readdirSync(nvidiaPath);
        console.log(`[Render] NVIDIA libs (${allLibs.length} files): ${allLibs.filter(f => f.includes('vulkan') || f.includes('EGL') || f.includes('nvidia')).join(', ')}`);
    }
    console.log(`[Render] LD_LIBRARY_PATH: ${process.env.LD_LIBRARY_PATH ?? '(unset)'}`);

    // ICD discovery files
    const eglVendorDir = '/usr/share/glvnd/egl_vendor.d';
    const vulkanIcdDir = '/usr/share/vulkan/icd.d';
    console.log(`[Render] EGL vendor configs: ${fs.existsSync(eglVendorDir) ? fs.readdirSync(eglVendorDir).join(', ') : '(dir missing)'}`);
    console.log(`[Render] Vulkan ICD configs: ${fs.existsSync(vulkanIcdDir) ? fs.readdirSync(vulkanIcdDir).join(', ') : '(dir missing)'}`);

    // nvidia-smi
    try {
        const smi = execSync('nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader', { timeout: 5000 }).toString().trim();
        console.log(`[Render] nvidia-smi: ${smi}`);
    } catch (e) {
        console.warn(`[Render] nvidia-smi failed (GPU not visible at OS level): ${e}`);
    }

    // NVIDIA device nodes
    for (const dev of ['/dev/nvidia0', '/dev/nvidiactl', '/dev/nvidia-uvm']) {
        console.log(`[Render] ${dev}: ${fs.existsSync(dev) ? 'EXISTS' : 'MISSING'}`);
    }

    // Vulkan
    try {
        const vkInfo = execSync('VK_LOADER_DEBUG=error vulkaninfo --summary 2>&1 | head -50', { timeout: 10000 }).toString().trim();
        console.log(`[Render] vulkaninfo: ${vkInfo}`);
    } catch (e) {
        console.warn(`[Render] vulkaninfo failed: ${e}`);
    }

    // VA-API
    try {
        const vaInfo = execSync('vainfo 2>&1 | head -30', { timeout: 10000 }).toString().trim();
        console.log(`[Render] vainfo:\n${vaInfo}`);
    } catch (e) {
        console.warn(`[Render] vainfo failed: ${e}`);
    }

    // DRM render nodes
    try {
        const driPath = '/dev/dri';
        if (fs.existsSync(driPath)) {
            const devices = fs.readdirSync(driPath);
            console.log(`[Render] /dev/dri/ devices: ${devices.join(', ')}`);
        } else {
            console.warn(`[Render] /dev/dri/ missing — attempting to create render node...`);
            try {
                execSync('modprobe nvidia-drm 2>&1 || true', { timeout: 5000 });
                console.log(`[Render] modprobe nvidia-drm attempted`);
            } catch { /* may not have permission */ }
            try {
                execSync('nvidia-smi -q -d DISPLAY 2>&1 | head -5', { timeout: 5000 });
            } catch { /* ignore */ }
            try {
                execSync('mkdir -p /dev/dri && mknod /dev/dri/renderD128 c 226 128 && chmod 666 /dev/dri/renderD128', { timeout: 5000 });
                console.log(`[Render] Created /dev/dri/renderD128 manually`);
            } catch (e2) {
                console.warn(`[Render] Failed to create DRM device: ${e2}`);
            }
            if (fs.existsSync(driPath)) {
                console.log(`[Render] /dev/dri/ now has: ${fs.readdirSync(driPath).join(', ')}`);
            } else {
                console.error(`[Render] /dev/dri/ STILL missing — GPU rendering unavailable`);
            }
        }
    } catch (e) {
        console.warn(`[Render] DRM device check failed: ${e}`);
    }
}

/** Log browser-level WebGL/GPU info. Called once at startup with a temp page. */
export async function logBrowserGpuInfo(page: Page): Promise<void> {
    // The callback runs inside Playwright's browser context (has document/navigator)
    const gpuInfo = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        const debugInfo = gl?.getExtension('WEBGL_debug_renderer_info');
        const renderer = debugInfo ? gl!.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'unknown';
        const vendor = debugInfo ? gl!.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'unknown';

        const c2d = document.createElement('canvas');
        const ctx = c2d.getContext('2d');
        const attrs = ctx?.getContextAttributes?.();

        return {
            renderer,
            vendor,
            canvas2dAccelerated: attrs?.willReadFrequently === false,
            canvas2dAttrs: JSON.stringify(attrs ?? {}),
            hardwareConcurrency: navigator.hardwareConcurrency,
        };
    });
    console.log(`[Render] GPU info:`, JSON.stringify(gpuInfo));
}
