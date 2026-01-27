/**
 * HoveredCardDetector - Detects overlay/card elements on hover
 * 
 * Detection criteria:
 * - Visual signal (any ONE): box-shadow OR drop-shadow OR border OR modal backdrop OR opaque background
 * - Size: 200x200px min, 80% viewport max
 * - Must be fully visible in viewport
 * 
 * Tracks stable hover sessions (2+ seconds) and emits events.
 */

import type { Rect } from '../../core/types';

export interface HoveredCardEvent {
    type: 'hoveredCard';
    startTime: number;
    endTime: number;
    rect: Rect;
    cornerRadius: [number, number, number, number]; // [tl, tr, br, bl]
}

interface DetectionResult {
    element: Element;
    effectiveRadius: [number, number, number, number];
}

// Debug flag - set to true to show pink highlight border
const DEBUG_SHOW_HOVERED_CARD = true;

// Minimum duration (ms) for a hovered card session to be reported
const MIN_SESSION_DURATION_MS = 2000;

export class HoveredCardDetector {
    private highlightElement: HTMLDivElement | null = null;
    private currentCard: DetectionResult | null = null;
    private currentCardRect: DOMRect | null = null;
    private sessionStartTime: number | null = null;

    private onEvent: (event: HoveredCardEvent) => void;

    constructor(onEvent: (event: HoveredCardEvent) => void) {
        this.onEvent = onEvent;
    }

    /**
     * Call this on mousemove/hover events to update detection
     */
    public updateFromTarget(target: Element): void {
        const result = this.findHoveredCard(target);

        // Get current rect for comparison
        const currentRect = result?.element.getBoundingClientRect() ?? null;

        // Check if this is the same card at the same position
        const isSameCard = result?.element === this.currentCard?.element;
        const isSamePosition = this.isSamePosition(currentRect, this.currentCardRect);

        if (isSameCard && isSamePosition) {
            // Same card, same position - just update highlight position if needed
            this.updateHighlightPosition(result!, currentRect!);
            return;
        }

        // Card or position changed - flush previous session if valid
        this.flushSession();

        // Start new session
        this.currentCard = result;
        this.currentCardRect = currentRect;
        this.sessionStartTime = result ? Date.now() : null;

        // Update visual highlight
        this.updateHighlight(result);

        if (result) {
            console.log('[HoveredCard] Changed:', result.element);
        }
    }

    /**
     * Call this when recording stops or on page unload to flush any pending session
     */
    public flush(): void {
        this.flushSession();
        this.hideHighlight();
        this.currentCard = null;
        this.currentCardRect = null;
        this.sessionStartTime = null;
    }

    /**
     * Check if two rects are at the same position (within 1px tolerance)
     */
    private isSamePosition(a: DOMRect | null, b: DOMRect | null): boolean {
        if (!a || !b) return a === b;
        return Math.abs(a.left - b.left) < 1 &&
            Math.abs(a.top - b.top) < 1 &&
            Math.abs(a.width - b.width) < 1 &&
            Math.abs(a.height - b.height) < 1;
    }

    /**
     * Flush the current session if it's been stable for 2+ seconds
     */
    private flushSession(): void {
        if (!this.currentCard || !this.sessionStartTime || !this.currentCardRect) {
            return;
        }

        const duration = Date.now() - this.sessionStartTime;
        if (duration >= MIN_SESSION_DURATION_MS) {
            const event: HoveredCardEvent = {
                type: 'hoveredCard',
                startTime: this.sessionStartTime,
                endTime: Date.now(),
                rect: {
                    x: this.currentCardRect.left,
                    y: this.currentCardRect.top,
                    width: this.currentCardRect.width,
                    height: this.currentCardRect.height,
                },
                cornerRadius: this.currentCard.effectiveRadius,
            };

            console.log('[HoveredCard] Session ended:', event);
            this.onEvent(event);
        }
    }

    /**
     * Get raw border radius values from an element as [tl, tr, br, bl].
     * Also checks clip-path: inset(... round X) as a fallback.
     */
    private getCornerRadius(element: Element): [number, number, number, number] {
        const style = window.getComputedStyle(element);

        let tl = parseFloat(style.borderTopLeftRadius) || 0;
        let tr = parseFloat(style.borderTopRightRadius) || 0;
        let br = parseFloat(style.borderBottomRightRadius) || 0;
        let bl = parseFloat(style.borderBottomLeftRadius) || 0;

        // If no border-radius, check clip-path for inset(...round X) pattern
        if (tl === 0 && tr === 0 && br === 0 && bl === 0) {
            const clipPath = style.clipPath;
            if (clipPath && clipPath.includes('round')) {
                const roundMatch = clipPath.match(/round\s+([\d.]+)(?:px)?\s*([\d.]+)?(?:px)?\s*([\d.]+)?(?:px)?\s*([\d.]+)?(?:px)?/);
                if (roundMatch) {
                    const r1 = parseFloat(roundMatch[1]) || 0;
                    const r2 = roundMatch[2] ? parseFloat(roundMatch[2]) : r1;
                    const r3 = roundMatch[3] ? parseFloat(roundMatch[3]) : r1;
                    const r4 = roundMatch[4] ? parseFloat(roundMatch[4]) : r2;
                    tl = r1; tr = r2; br = r3; bl = r4;
                }
            }
        }

        return [tl, tr, br, bl];
    }

    /**
     * Convert corner radius array to CSS border-radius string with padding
     */
    private cornerRadiusToString(radius: [number, number, number, number], padding: number): string {
        return `${radius[0] + padding}px ${radius[1] + padding}px ${radius[2] + padding}px ${radius[3] + padding}px`;
    }

    /**
     * Check if an element is a modal backdrop (full viewport + semi-transparent bg)
     */
    private isBackdrop(el: Element, viewportWidth: number, viewportHeight: number): boolean {
        const elRect = el.getBoundingClientRect();
        const isFullViewport = elRect.width >= viewportWidth * 0.9 && elRect.height >= viewportHeight * 0.9;
        if (!isFullViewport) return false;

        const elStyle = window.getComputedStyle(el);
        const bgColor = elStyle.backgroundColor;
        const rgbaMatch = bgColor.match(/rgba?\([\d\s,]+,\s*([\d.]+)\)/);
        return !!(rgbaMatch && parseFloat(rgbaMatch[1]) > 0 && parseFloat(rgbaMatch[1]) < 1);
    }

    /**
     * Find the outermost hovered card ancestor matching detection criteria.
     */
    private findHoveredCard(element: Element): DetectionResult | null {
        let current: Element | null = element;
        let farthestMatch: Element | null = null;
        let farthestMatchRadius: [number, number, number, number] = [0, 0, 0, 0];

        // Track bubbled radius from same-size children
        let bubbledRadius: [number, number, number, number] = [0, 0, 0, 0];
        let lastRect: DOMRect | null = null;

        // Cache viewport dimensions
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const minSize = 200;

        while (current && current !== document.body && current !== document.documentElement) {
            const style = window.getComputedStyle(current);
            const rect = current.getBoundingClientRect();

            // Get this element's corner radius
            const currentRadius = this.getCornerRadius(current);

            // Check if same size as previous (child) - bubble up larger radius
            const isSameSize = lastRect &&
                Math.abs(rect.width - lastRect.width) < 2 &&
                Math.abs(rect.height - lastRect.height) < 2;

            if (isSameSize) {
                bubbledRadius = [
                    Math.max(currentRadius[0], bubbledRadius[0]),
                    Math.max(currentRadius[1], bubbledRadius[1]),
                    Math.max(currentRadius[2], bubbledRadius[2]),
                    Math.max(currentRadius[3], bubbledRadius[3])
                ];
            } else {
                bubbledRadius = currentRadius;
            }

            lastRect = rect;

            // Size constraints
            const meetsMinSize = rect.width >= minSize && rect.height >= minSize;
            const meetsMaxSize = rect.width <= viewportWidth * 0.8 && rect.height <= viewportHeight * 0.8;

            // Visual signals
            const hasBoxShadow = style.boxShadow && style.boxShadow !== 'none';
            const hasDropShadow = style.filter && style.filter.includes('drop-shadow');
            const hasBorder = style.borderWidth && parseFloat(style.borderWidth) > 0 && style.borderStyle !== 'none';

            // Check for modal backdrop (parent or sibling)
            let hasModalBackdrop = false;
            const parent = current.parentElement;

            if (parent && parent !== document.body) {
                if (this.isBackdrop(parent, viewportWidth, viewportHeight)) {
                    hasModalBackdrop = true;
                } else {
                    let sibling = current.previousElementSibling;
                    while (sibling) {
                        if (this.isBackdrop(sibling, viewportWidth, viewportHeight)) {
                            hasModalBackdrop = true;
                            break;
                        }
                        sibling = sibling.previousElementSibling;
                    }
                }
            }

            // Check for opaque background
            const bgColor = style.backgroundColor;
            const isTransparent = bgColor === 'transparent' || bgColor === 'rgba(0, 0, 0, 0)';
            const rgbaAlphaMatch = bgColor.match(/rgba\([^)]+,\s*([\d.]+)\)/);
            const hasOpaqueBackground = !isTransparent && (!rgbaAlphaMatch || parseFloat(rgbaAlphaMatch[1]) > 0);

            const hasVisualSignal = hasBoxShadow || hasDropShadow || hasBorder || hasModalBackdrop || hasOpaqueBackground;

            // Check if fully visible in viewport
            const isFullyInViewport = rect.left >= 0 && rect.top >= 0 &&
                rect.right <= viewportWidth && rect.bottom <= viewportHeight;

            if (meetsMinSize && meetsMaxSize && hasVisualSignal && isFullyInViewport) {
                farthestMatch = current;
                farthestMatchRadius = bubbledRadius;
            }

            // Move to parent, handling Shadow DOM boundaries
            if (current.parentElement) {
                current = current.parentElement;
            } else {
                const root = current.getRootNode();
                if (root instanceof ShadowRoot && root.host) {
                    current = root.host;
                } else {
                    current = null;
                }
            }
        }

        return farthestMatch ? { element: farthestMatch, effectiveRadius: farthestMatchRadius } : null;
    }

    /**
     * Update the debug highlight to show the detected card
     */
    private updateHighlight(result: DetectionResult | null): void {
        if (!DEBUG_SHOW_HOVERED_CARD) {
            this.hideHighlight();
            return;
        }

        this.hideHighlight();

        if (!result) return;

        const rect = result.element.getBoundingClientRect();
        const padding = 5;
        const adjustedRadius = this.cornerRadiusToString(result.effectiveRadius, padding);

        this.highlightElement = document.createElement('div');
        this.highlightElement.id = 'recordio-hovered-card-highlight';
        this.highlightElement.style.cssText = `
            position: fixed;
            left: ${rect.left - padding}px;
            top: ${rect.top - padding}px;
            width: ${rect.width + padding * 2}px;
            height: ${rect.height + padding * 2}px;
            background: transparent;
            pointer-events: none;
            z-index: 2147483646;
            box-sizing: border-box;
            border: 12px solid #ec4899;
            border-radius: ${adjustedRadius};
        `;
        document.body.appendChild(this.highlightElement);
    }

    /**
     * Update highlight position without recreating the element
     */
    private updateHighlightPosition(result: DetectionResult, rect: DOMRect): void {
        if (!DEBUG_SHOW_HOVERED_CARD || !this.highlightElement) return;

        const padding = 5;
        this.highlightElement.style.left = `${rect.left - padding}px`;
        this.highlightElement.style.top = `${rect.top - padding}px`;
        this.highlightElement.style.width = `${rect.width + padding * 2}px`;
        this.highlightElement.style.height = `${rect.height + padding * 2}px`;
        this.highlightElement.style.borderRadius = this.cornerRadiusToString(result.effectiveRadius, padding);
    }

    /**
     * Remove the debug highlight
     */
    private hideHighlight(): void {
        if (this.highlightElement) {
            this.highlightElement.remove();
            this.highlightElement = null;
        }
    }
}
