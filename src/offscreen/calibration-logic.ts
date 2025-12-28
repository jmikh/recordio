import type { UserEvents, Size } from '../core/types';

export interface CalibrationResult {
    pixelRatio: number;
    viewportInVideo: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}

export function detectCalibrationMarkers(
    ctx: CanvasRenderingContext2D,
    videoSize: Size,
    viewportSize: Size, // Already scaled by DPR (Physical Pixels)
    dpr: number
): CalibrationResult | null {

    // Pattern Definition: 
    // Markers are 50x50 CSS pixels (so 50*dpr physical pixels).
    // Color 1: Red (#FF0000) at edges.
    // Color 2: Blue (#0000FF) at center.

    // We assume the viewport is bottom-aligned in the video stream.
    const expectedW = Math.round(viewportSize.width);
    const expectedH = Math.round(viewportSize.height);

    // Check 1: Width Consistency
    const widthDiff = Math.abs(videoSize.width - expectedW);
    if (widthDiff > 50) {
        // console.warn(`[Calibration] Width mismatch. Video: ${videoSize.width}, Expected: ${expectedW} (dpr ${dpr})`);
        // Just return null quietly or log
        console.log(`[Calibration] Width Mismatch. Video: ${videoSize.width}, Viewport(px): ${expectedW} (dpr: ${dpr})`);
        return null;
    }

    // Coordinates of Top-Left of the *content* viewport within the video frame
    const viewportX = 0;
    const viewportY = videoSize.height - expectedH;

    const imageData = ctx.getImageData(0, 0, videoSize.width, videoSize.height);
    const data = imageData.data;

    // Helper to check pixel color
    const checkColor = (x: number, y: number, rMin: number, gMax: number, bMin: number) => {
        const px = Math.min(Math.max(Math.floor(x), 0), videoSize.width - 1);
        const py = Math.min(Math.max(Math.floor(y), 0), videoSize.height - 1);
        const idx = (py * videoSize.width + px) * 4;

        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        // Simple thresholding
        return r >= rMin && g <= gMax && b >= bMin;
    };

    const isRed = (x: number, y: number) => checkColor(x, y, 200, 100, 0); // Expect Red > 200, G < 100
    const isBlue = (x: number, y: number) => checkColor(x, y, 0, 100, 200); // Expect Blue > 200

    // Check a single marker at relative CSS position (rx, ry)
    const checkMarker = (name: string, rx: number, ry: number): boolean => {
        // Convert CSS relative coordinates to Physical video coordinates
        // Center of the 50x50 marker is at (rx + 25, ry + 25) CSS

        const centerX = viewportX + (rx + 25) * dpr;
        const centerY = viewportY + (ry + 25) * dpr;

        // Inner Blue Square is 20x20 CSS (radius 10)
        // Check Center for Blue
        if (!isBlue(centerX, centerY)) {
            console.log(`[Calibration] ${name} failed inner BLUE check at ${centerX},${centerY}`);
            return false;
        }

        // Outer Red Border
        // Check 15px out from center (still inside 50x50, but outside 20x20)
        const offset = 20 * dpr;
        if (!isRed(centerX - offset, centerY - offset)) {
            console.log(`[Calibration] ${name} failed outer RED check (TL)`);
            return false;
        }
        if (!isRed(centerX + offset, centerY + offset)) {
            console.log(`[Calibration] ${name} failed outer RED check (BR)`);
            return false;
        }

        return true;
    };

    // Verify 4 Corners
    // TL: 0,0
    const tl = checkMarker('TL', 0, 0);

    // TR: W-50, 0
    // We need CSS coordinates for checkMarker.
    // viewportSize.width is physical pixels.
    const cssW = viewportSize.width / dpr;
    const cssH = viewportSize.height / dpr;

    const tr = checkMarker('TR', cssW - 50, 0);

    // BL: 0, H-50
    const bl = checkMarker('BL', 0, cssH - 50);

    // BR: W-50, H-50
    const br = checkMarker('BR', cssW - 50, cssH - 50);

    if (tl && tr && bl && br) {
        return {
            pixelRatio: dpr,
            viewportInVideo: {
                x: viewportX,
                y: viewportY,
                width: expectedW,
                height: expectedH
            }
        }
    } else {
        console.log(`[Calibration] Failed. Markers found: TL=${tl}, TR=${tr}, BL=${bl}, BR=${br}`);
        return null;
    }
}

/**
 * Checks if the provided stream is recording the calibration window.
 * Captures a frame, looks for markers, and returns the calibration result.
 */
export async function checkWindowCalibration(
    stream: MediaStream,
    viewportSize: Size,
    dpr: number
): Promise<{ success: boolean, yOffset: number } | null> {

    let video: HTMLVideoElement | null = null;
    let canvas: HTMLCanvasElement | null = null;

    try {
        video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        await video.play();

        // Give a moment for the window to render fully if needed, though usually handled by caller or wait loop
        await new Promise(r => setTimeout(r, 800));

        canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');

        if (!ctx) return null;

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const result = detectCalibrationMarkers(
            ctx,
            { width: video.videoWidth, height: video.videoHeight },
            { width: viewportSize.width * dpr, height: viewportSize.height * dpr },
            dpr
        );

        if (result) {
            return {
                success: true,
                yOffset: result.viewportInVideo.y
            };
        }

    } catch (e) {
        console.error("[Calibration] Check failed", e);
    } finally {
        if (video) {
            video.srcObject = null;
            video.remove();
        }
        if (canvas) {
            canvas.remove();
        }
    }
    return null;
}

/**
 * Remaps user events from Viewport coordinates to Video Stream coordinates.
 * Assumes the Viewport is a subset of the Video Stream (e.g. window recording with chrome UI excluded from viewport but included in video).
 */
export function remapUserEvents(events: UserEvents, yOffset: number): UserEvents {


    // Helper to remap a generic coordinate set
    const transformPoint = (p: { x: number, y: number }) => ({
        x: p.x,
        y: p.y + yOffset
    });

    const transformRect = (r: { x: number, y: number, width: number, height: number }) => ({
        x: r.x,
        y: r.y + yOffset,
        width: r.width,
        height: r.height
    });

    // Helper to remap a generic event if it has mousePos
    const remap = <T extends { mousePos?: { x: number, y: number }, targetRect?: { x: number, y: number, width: number, height: number } }>(ev: T): T => {
        const newEv = { ...ev };
        if (newEv.mousePos) {
            newEv.mousePos = transformPoint(newEv.mousePos);
        }
        if (newEv.targetRect) {
            newEv.targetRect = transformRect(newEv.targetRect);
        }
        return newEv;
    };

    return {
        mouseClicks: events.mouseClicks.map(remap),
        mousePositions: events.mousePositions.map(remap),
        keyboardEvents: events.keyboardEvents.map(remap),
        drags: events.drags.map(ev => {
            const newEv = remap(ev);
            if (newEv.path) {
                newEv.path = newEv.path.map(p => ({
                    ...p,
                    mousePos: transformPoint(p.mousePos)
                }));
            }
            return newEv;
        }),
        scrolls: events.scrolls.map(remap),
        typingEvents: events.typingEvents.map(remap),
        urlChanges: events.urlChanges.map(remap),
    };
}
