/**
 * @fileoverview Window detection logic for recordings.
 * Detects if the recorded video contains the expected calibration markers that 
 * indicate the video was recorded from the current window. Uses center-based
 * detection (finding the inner marker centroid) to derive accurate viewport
 * offsets, immune to video compression artifacts at marker edges.
 */

import { captureException } from '../utils/sentry';

// Marker Definition
// Outer: 50x50 Primary (Purple/Magenta from OKLCH: oklch(0.58 0.19 290))
// Inner: 20x20 Secondary (Lime/Green from OKLCH: oklch(0.80 0.15 78))
// Tolerance for color matching (due to video compression)

export interface WindowDetectionResult { // Renamed from CalibrationResult
    isControllerWindow: boolean;
    yOffset: number;
    xOffset: number; // Might have side borders
}


export async function detectControllerWindow(stream: MediaStream): Promise<WindowDetectionResult> {
    const video = document.createElement('video');
    video.srcObject = stream;
    // Attributes to help with background execution
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    const cleanup = () => {
        video.srcObject = null;
        video.remove();
    };

    return new Promise((resolve) => {
        // Timeout Safety — generous to handle slow stream initialization when switching sources
        const timeoutId = setTimeout(() => {
            console.warn("[VideoValidation] Stream Validation timed out. Returning invalid.");
            cleanup();
            resolve({ isControllerWindow: false, xOffset: 0, yOffset: 0 });
        }, 4000);

        const tryExtractFrame = (retriesLeft: number) => {
            try {
                // Video dimensions may not be ready yet on newly-switched streams
                if (video.videoWidth === 0 || video.videoHeight === 0) {
                    if (retriesLeft > 0) {
                        setTimeout(() => tryExtractFrame(retriesLeft - 1), 200);
                        return;
                    }
                    // Give up after retries
                    clearTimeout(timeoutId);
                    cleanup();
                    return resolve({ isControllerWindow: false, xOffset: 0, yOffset: 0 });
                }

                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });

                if (!ctx) {
                    clearTimeout(timeoutId);
                    cleanup();
                    return resolve({ isControllerWindow: false, xOffset: 0, yOffset: 0 });
                }

                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const dpr = window.devicePixelRatio || 1;
                // @ts-ignore
                const result = findMarkers(imageData, dpr);

                clearTimeout(timeoutId);
                cleanup();
                resolve(result);
            } catch (e) {
                console.error("[VideoValidation] Error extracting frame:", e);
                captureException(e instanceof Error ? e : new Error(String(e)));
                clearTimeout(timeoutId);
                cleanup();
                resolve({ isControllerWindow: false, xOffset: 0, yOffset: 0 });
            }
        };

        video.onloadedmetadata = () => {
            video.play().catch(e => console.warn("Autoplay prevented:", e));
        };

        video.onplaying = () => {
            // Give it a small delay to ensure frame is painted, then try with retries
            requestAnimationFrame(() => {
                tryExtractFrame(5);
            });
        };

        video.onerror = () => {
            clearTimeout(timeoutId);
            cleanup();
            resolve({ isControllerWindow: false, xOffset: 0, yOffset: 0 });
        };
    });
}

function findMarkers(imageData: ImageData, dpr: number): WindowDetectionResult {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;

    // Center-Based Detection Strategy:
    // The marker is defined in CSS pixels (50x50 outer, 20x20 inner) but the video
    // frame is captured at device pixel resolution. All geometry constants must be
    // scaled by DPR. We scan for the Secondary (lime) inner marker center, find its
    // centroid, and subtract the known CSS center position (25, 25) * DPR.

    // CSS pixel constants scaled to device pixels
    const MARKER_CENTER_CSS = 25; // Center of 50x50 marker
    const VERIFY_OFFSET_CSS = 15; // Distance from inner center to primary annulus
    const markerCenter = Math.round(MARKER_CENTER_CSS * dpr);
    const verifyOffset = Math.round(VERIFY_OFFSET_CSS * dpr);

    const searchHeight = Math.min(height, Math.round(300 * dpr));
    const searchWidth = Math.min(width, Math.round(200 * dpr));

    // Colors (approximate RGB conversions from OKLCH)
    // Primary: oklch(0.58 0.19 290) ≈ Purple/Magenta RGB(171, 79, 188)
    // Secondary: oklch(0.80 0.15 78) ≈ Lime/Green RGB(188, 213, 115)

    function isPrimary(r: number, g: number, b: number) {
        return r > 110 && r < 230 && g > 20 && g < 140 && b > 120 && b < 250;
    }

    function isSecondary(r: number, g: number, b: number) {
        return r > 130 && r < 250 && g > 150 && g < 255 && b > 55 && b < 175;
    }

    function getPixel(x: number, y: number) {
        const idx = (y * width + x) * 4;
        return { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
    }

    function isSecondaryAt(x: number, y: number) {
        if (x < 0 || x >= width || y < 0 || y >= height) return false;
        const p = getPixel(x, y);
        return isSecondary(p.r, p.g, p.b);
    }

    function isPrimaryAt(x: number, y: number) {
        if (x < 0 || x >= width || y < 0 || y >= height) return false;
        const p = getPixel(x, y);
        return isPrimary(p.r, p.g, p.b);
    }

    // Scan for Secondary (lime) pixels — the inner marker center
    for (let y = 0; y < searchHeight; y++) {
        for (let x = 0; x < searchWidth; x++) {
            if (!isSecondaryAt(x, y)) continue;

            // Found a secondary pixel. First find the centroid of the
            // contiguous secondary region by expanding in all 4 directions.
            let left = x, right = x, top = y, bottom = y;

            while (left > 0 && isSecondaryAt(left - 1, y)) left--;
            while (right < width - 1 && isSecondaryAt(right + 1, y)) right++;
            while (top > 0 && isSecondaryAt(x, top - 1)) top--;
            while (bottom < height - 1 && isSecondaryAt(x, bottom + 1)) bottom++;

            const centerX = Math.round((left + right) / 2);
            const centerY = Math.round((top + bottom) / 2);

            // Now verify from the centroid that Primary pixels surround it.
            // From the inner center, ±verifyOffset lands in the Primary annulus.
            if (!isPrimaryAt(centerX - verifyOffset, centerY) || !isPrimaryAt(centerX + verifyOffset, centerY) ||
                !isPrimaryAt(centerX, centerY - verifyOffset) || !isPrimaryAt(centerX, centerY + verifyOffset)) {
                // Not the marker — skip past this region
                x = right;
                continue;
            }

            // The inner marker center is at CSS position (25, 25) = markerCenter device pixels.
            const xOffset = centerX - markerCenter;
            const yOffset = centerY - markerCenter;

            return {
                isControllerWindow: true,
                xOffset: Math.max(0, xOffset),
                yOffset: Math.max(0, yOffset)
            };
        }
    }

    return { isControllerWindow: false, xOffset: 0, yOffset: 0 };
}
