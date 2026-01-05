/**
 * @fileoverview Window detection logic for recordings.
 * Detects if the recorded video contains the expected calibration markers that 
 * indicate the video was recorded from the current window. That allows us to 
 * calculate the viewport offsets and apply them to the recorded events for auto zoom.
 */

// Marker Definition
// Outer: 50x50 Red (#FF0000)
// Inner: 20x20 Blue (#0000FF) centered
// Tolerance for color matching (due to video compression)

// Inner: 20x20 Blue (#0000FF) centered
// Tolerance for color matching (due to video compression)

// Inner: 20x20 Blue (#0000FF) centered
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
        // Timeout Safety
        const timeoutId = setTimeout(() => {
            console.warn("[VideoValidation] Stream Validation timed out. Returning invalid.");
            cleanup();
            resolve({ isControllerWindow: false, xOffset: 0, yOffset: 0 });
        }, 1500);

        const extractFrame = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });

                if (!ctx) {
                    clearTimeout(timeoutId);
                    cleanup();
                    // Resolve invalid rather than reject
                    return resolve({ isControllerWindow: false, xOffset: 0, yOffset: 0 });
                }

                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                // @ts-ignore
                const result = findMarkers(imageData);

                clearTimeout(timeoutId);
                cleanup();
                resolve(result);
            } catch (e) {
                console.error("[VideoValidation] Error extracting frame:", e);
                clearTimeout(timeoutId);
                cleanup();
                resolve({ isControllerWindow: false, xOffset: 0, yOffset: 0 });
            }
        };

        video.onloadedmetadata = () => {
            video.play().catch(e => console.warn("Autoplay prevented:", e));
        };

        video.onplaying = () => {
            // Give it a small delay to ensure frame is painted
            requestAnimationFrame(() => {
                extractFrame(); // or wait a bit more?
            });
        };

        video.onerror = () => {
            clearTimeout(timeoutId);
            cleanup();
            resolve({ isControllerWindow: false, xOffset: 0, yOffset: 0 });
        };
    });
}

export async function detectWindowInBlob(blob: Blob): Promise<WindowDetectionResult> { // Renamed from detectCalibrationInBlob
    const videoUrl = URL.createObjectURL(blob);
    const video = document.createElement('video');

    // Cleanup helper
    const cleanup = () => {
        URL.revokeObjectURL(videoUrl);
        video.remove();
    };

    return new Promise((resolve, reject) => {
        // Timeout Safety
        const timeoutId = setTimeout(() => {
            console.warn("[VideoValidation] Validation timed out (background tab?). Returning invalid.");
            cleanup();
            resolve({ isControllerWindow: false, xOffset: 0, yOffset: 0 });
        }, 3000); // 3 seconds timeout

        const extractFrame = () => {
            try {
                if (video.readyState < 2) {
                    console.warn("[VideoValidation] Video not ready on seeked.");
                }

                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });

                if (!ctx) {
                    clearTimeout(timeoutId);
                    cleanup();
                    return reject(new Error("Could not create canvas context for validation"));
                }

                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const result = findMarkers(imageData);

                clearTimeout(timeoutId);
                cleanup();
                resolve(result);
            } catch (e) {
                clearTimeout(timeoutId);
                cleanup();
                reject(e);
            }
        };

        video.onseeked = () => {
            extractFrame();
        };

        video.onerror = () => {
            clearTimeout(timeoutId);
            cleanup();
            reject(new Error("Video load error"));
        };

        video.onloadedmetadata = () => {
            // Seek to a safe frame (e.g. 0.1s to ensure we have content)
            video.currentTime = 0.1;
        };

        // Attributes to help with background execution
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';

        video.src = videoUrl;
        video.load();
    });
}

function findMarkers(imageData: ImageData): WindowDetectionResult {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;

    // We scan for the Top-Left Marker.
    // We expect it within the top region of the video.
    // The marker is 50x50 Red with 20x20 Blue in middle.
    // So if we find a Red pixel, we check if it is part of a 50x50 block with Blue center.

    // Optimization: Only scan top portion for the top-left marker.
    // Let's scan the first 1/3rd of height.
    // And left side (say first 100px).

    const searchHeight = Math.min(height, 300); // Assume header isn't larger than 300
    const searchWidth = Math.min(width, 200);   // Assume left offset isn't huge

    // Colors
    // Red: 255, 0, 0. Blue: 0, 0, 255.
    // Tolerance
    const tol = 60;

    function isRed(r: number, g: number, b: number) {
        return r > 255 - tol && g < tol && b < tol;
    }

    function isBlue(r: number, g: number, b: number) {
        return b > 255 - tol && r < tol && g < tol;
    }

    // Helper to get pixel
    function getPixel(x: number, y: number) {
        const idx = (y * width + x) * 4;
        return {
            r: data[idx],
            g: data[idx + 1],
            b: data[idx + 2]
        };
    }

    // Search for a candidate Top-Left Corner of the Red Box
    // The Red Box is 50x50.
    // At (x,y), if we are at top-left of red box:
    // (x+25, y+25) should be Blue (center).
    // (x+5, y+5) should be Red.

    for (let y = 0; y < searchHeight; y++) {
        for (let x = 0; x < searchWidth; x++) {
            const p = getPixel(x, y);
            if (isRed(p.r, p.g, p.b)) {
                // Potential top-left of red marker?
                // Check center (offset 25, 25)
                const cx = x + 25;
                const cy = y + 25;

                if (cx < width && cy < height) {
                    const c = getPixel(cx, cy);
                    // Center should be Blue
                    if (isBlue(c.r, c.g, c.b)) {
                        // Found Candidate!
                        // Let's verify a bit more.
                        // Top-Right of marker (x+45, y+5) should be Red
                        const tr = getPixel(x + 45, y + 5);
                        if (isRed(tr.r, tr.g, tr.b)) {
                            // High confidence this is the marker.
                            // The markers are at viewport (0,0).
                            // So video (x,y) corresponds to viewport (0,0).
                            // y is the Y-Offset (header height).
                            // x is the X-Offset.

                            return {
                                isControllerWindow: true,
                                xOffset: x,
                                yOffset: y
                            };
                        }
                    }
                }
            }
        }
    }

    return { isControllerWindow: false, xOffset: 0, yOffset: 0 };
}
