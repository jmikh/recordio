import type { Size, Point, Rect } from '../types';



export class ViewTransform {
    inputVideoSize: Size;
    outputVideoSize: Size;
    paddingPercentage: number;

    /**
     * The rectangle in Output Space where the content (video) is placed.
     * Calculated based on aspect ratio fit and padding.
     */
    public readonly contentRect: Rect;

    constructor(
        inputVideoSize: Size,
        outputVideoSize: Size,
        paddingPercentage: number
    ) {
        this.outputVideoSize = outputVideoSize;
        this.inputVideoSize = inputVideoSize;
        this.paddingPercentage = paddingPercentage;

        // Calculate Scale to fit input into output (considering padding)
        const scale = Math.max(
            this.inputVideoSize.width / (this.outputVideoSize.width * (1 - 2 * this.paddingPercentage)),
            this.inputVideoSize.height / (this.outputVideoSize.height * (1 - 2 * this.paddingPercentage))
        );

        // Calculate dimensions of the content in Output Space
        const projectedWidth = this.inputVideoSize.width / scale;
        const projectedHeight = this.inputVideoSize.height / scale;

        const x = (this.outputVideoSize.width - projectedWidth) / 2;
        const y = (this.outputVideoSize.height - projectedHeight) / 2;

        this.contentRect = { x, y, width: projectedWidth, height: projectedHeight };
    }

    /**
     * Maps a point from Input Space (Source Video) to Output Space (Canvas).
     */
    inputToOutput(point: Point): Point {
        // 1. Normalize in Input Space (0..1)
        const nx = point.x / this.inputVideoSize.width;
        const ny = point.y / this.inputVideoSize.height;

        // 2. Map to ContentRect in Output Space
        return {
            x: this.contentRect.x + nx * this.contentRect.width,
            y: this.contentRect.y + ny * this.contentRect.height
        };
    }

    /**
     * Calculates the source and destination rectangles for rendering the video 
     * based on the current CameraWindow (Output Space View).
     * 
     * @param cameraWindow The current visible window in Output Space.
     */
    resolveRenderRects(cameraWindow: Rect): { sourceRect: Rect, destRect: Rect } | null {
        // 1. Find Intersection of CameraWindow and ContentRect
        // This is the part of the Content visible in the Camera
        const intersection = getIntersection(cameraWindow, this.contentRect);

        if (!intersection) {
            return null; // Camera is looking entirely at padding/background
        }

        // 2. Calculate sourceRect (Input Space)
        // Map intersection (Output Space) -> Input Space
        const srcX = (intersection.x - this.contentRect.x) / this.contentRect.width * this.inputVideoSize.width;
        const srcY = (intersection.y - this.contentRect.y) / this.contentRect.height * this.inputVideoSize.height;
        const srcW = (intersection.width / this.contentRect.width) * this.inputVideoSize.width;
        const srcH = (intersection.height / this.contentRect.height) * this.inputVideoSize.height;

        // 3. Calculate destRect (Canvas/Screen Drawing Coordinates)
        // Map the visible intersection relative to the Camera Window
        // Scaling factor: Output Size / Camera Window Size
        const scaleX = this.outputVideoSize.width / cameraWindow.width;
        const scaleY = this.outputVideoSize.height / cameraWindow.height;

        const dstX = (intersection.x - cameraWindow.x) * scaleX;
        const dstY = (intersection.y - cameraWindow.y) * scaleY;
        const dstW = intersection.width * scaleX;
        const dstH = intersection.height * scaleY;

        return {
            sourceRect: { x: srcX, y: srcY, width: srcW, height: srcH },
            destRect: { x: dstX, y: dstY, width: dstW, height: dstH }
        };
    }

    /**
     * Maps a point from Input Space -> Screen Coordinates (pixels on the final canvas).
     */
    projectToScreen(point: Point, cameraWindow: Rect): Point {
        // 1. Input -> Output Space
        const outputPoint = this.inputToOutput(point);

        // 2. Output Space -> Screen (Relative to CameraWindow)
        // (p - cam.x) * scale
        const scaleX = this.outputVideoSize.width / cameraWindow.width;
        const scaleY = this.outputVideoSize.height / cameraWindow.height;

        return {
            x: (outputPoint.x - cameraWindow.x) * scaleX,
            y: (outputPoint.y - cameraWindow.y) * scaleY
        };
    }
}

// Helper
function getIntersection(r1: Rect, r2: Rect): Rect | null {
    const x = Math.max(r1.x, r2.x);
    const y = Math.max(r1.y, r2.y);
    const width = Math.min(r1.x + r1.width, r2.x + r2.width) - x;
    const height = Math.min(r1.y + r1.height, r2.y + r2.height) - y;

    if (width <= 0 || height <= 0) {
        return null;
    }
    return { x, y, width, height };
}
