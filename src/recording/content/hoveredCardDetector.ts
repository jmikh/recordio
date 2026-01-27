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
    private invalidatedLabel: HTMLDivElement | null = null;
    private currentCard: DetectionResult | null = null;
    private currentCardRect: DOMRect | null = null;
    private sessionStartTime: number | null = null;
    private sessionInvalidated: boolean = false;
    private mutationObserver: MutationObserver | null = null;

    // Mouse position tracking
    private lastMouseX: number = 0;
    private lastMouseY: number = 0;
    private isListening: boolean = false;

    private onEvent: (event: HoveredCardEvent) => void;

    constructor(onEvent: (event: HoveredCardEvent) => void) {
        this.onEvent = onEvent;
    }

    /**
     * Start listening for mouse, scroll, and resize events
     */
    public start(): void {
        if (this.isListening) return;
        this.isListening = true;

        document.addEventListener('mousemove', this.handleMouseMove, { capture: true });
        window.addEventListener('scroll', this.handleScroll, { capture: true });
        window.addEventListener('resize', this.handleResize);

        console.log('[HoveredCardDetector] Started listening');
    }

    /**
     * Stop listening and flush any pending session
     */
    public stop(): void {
        if (!this.isListening) return;
        this.isListening = false;

        document.removeEventListener('mousemove', this.handleMouseMove, { capture: true });
        window.removeEventListener('scroll', this.handleScroll, { capture: true });
        window.removeEventListener('resize', this.handleResize);

        this.flush();
        console.log('[HoveredCardDetector] Stopped listening');
    }

    /**
     * Handle mouse move - update position and check bounds or detect card
     */
    private handleMouseMove = (e: MouseEvent): void => {
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;

        if (this.currentCard && this.currentCardRect) {
            // Session active - just check if mouse is still within card bounds
            if (this.isMouseInCardBounds()) {
                // Still in bounds - update highlight position in case card moved
                this.updateHighlightPosition(this.currentCard, this.currentCardRect);
                return;
            }
            // Mouse left the card - flush session and fall through to detection
            this.flushSession();
        }

        // Get the actual deepest element (traverses into Shadow DOM)
        const composedPath = e.composedPath();
        const target = (composedPath[0] || e.target) as Element;

        // No active session or mouse left bounds - detect card at target
        this.detectCardFromTarget(target);
    };

    /**
     * Handle scroll - flush session and re-detect
     */
    private handleScroll = (): void => {
        // Scroll changes element positions, flush current session
        this.flushSession();
        // Re-detect at current mouse position (using elementFromPoint since we don't have an event)
        this.detectCardAtMousePosition();
    };

    /**
     * Handle resize - flush session (positions changed)
     */
    private handleResize = (): void => {
        this.flushSession();
    };

    /**
     * Check if the mouse is still within the current card's bounds
     */
    private isMouseInCardBounds(): boolean {
        if (!this.currentCardRect) return false;

        // Re-get the rect as it may have changed (e.g., animation)
        const rect = this.currentCard?.element.getBoundingClientRect();
        if (!rect) return false;

        // Update stored rect
        this.currentCardRect = rect;

        return this.lastMouseX >= rect.left &&
            this.lastMouseX <= rect.right &&
            this.lastMouseY >= rect.top &&
            this.lastMouseY <= rect.bottom;
    }

    /**
     * Detect which card is at the current mouse position (for scroll/resize handlers)
     */
    private detectCardAtMousePosition(): void {
        const target = document.elementFromPoint(this.lastMouseX, this.lastMouseY);
        if (!target) {
            this.updateHighlight(null);
            return;
        }
        this.detectCardFromTarget(target);
    }

    /**
     * Detect which card contains the given target element
     */
    private detectCardFromTarget(target: Element): void {
        const result = this.findHoveredCard(target);
        const currentRect = result?.element.getBoundingClientRect() ?? null;

        // Start new session
        this.currentCard = result;
        this.currentCardRect = currentRect;
        this.sessionStartTime = result ? Date.now() : null;
        this.sessionInvalidated = false;

        // Start observing for overlays if we have a valid card
        if (result) {
            this.startMutationObserver();
            console.log('[HoveredCard] Detected:', result.element);
        }

        // Update visual highlight
        this.updateHighlight(result);
    }

    /**
     * Flush any pending session without stopping listeners
     */
    public flush(): void {
        this.flushSession();
        this.hideHighlight();
        this.currentCard = null;
        this.currentCardRect = null;
        this.sessionStartTime = null;
        this.sessionInvalidated = false;
    }

    /**
     * Flush the current session if it's been stable for 2+ seconds and not invalidated
     */
    private flushSession(): void {
        // Stop observing mutations when session ends
        this.stopMutationObserver();

        if (!this.currentCard || !this.sessionStartTime || !this.currentCardRect) {
            return;
        }

        // Skip sending if session was invalidated (overlay extended outside card)
        if (this.sessionInvalidated) {
            console.log('[HoveredCard] Session invalidated, not sending event');
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
     * Start observing DOM mutations to detect overlays extending outside the card
     */
    private startMutationObserver(): void {
        this.stopMutationObserver();

        if (!this.currentCardRect) return;

        this.mutationObserver = new MutationObserver((mutations) => {
            // Already invalidated, no need to check further
            if (this.sessionInvalidated) return;

            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node instanceof Element) {
                        // Check the added node and all its descendants
                        const culprit = this.findExtendingElement(node);
                        if (culprit) {
                            this.invalidateSession(culprit);
                            return;
                        }
                    }
                }
            }
        });

        this.mutationObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    /**
     * Stop the mutation observer
     */
    private stopMutationObserver(): void {
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
            this.mutationObserver = null;
        }
    }

    /**
     * Recursively find an element (or descendant) that extends outside the card's bounding rect.
     * Returns the culprit element, or null if none found.
     */
    private findExtendingElement(element: Element): Element | null {
        if (!this.currentCardRect || !this.currentCard) return null;

        // Skip our own highlight elements
        if (element.id === 'recordio-hovered-card-highlight') return null;

        const elemRect = element.getBoundingClientRect();
        const cardRect = this.currentCardRect;

        // Skip elements with no dimensions (hidden or not laid out)
        if (elemRect.width === 0 || elemRect.height === 0) return null;

        // Check if element crosses the card boundary (not fully inside)
        const crossesBoundary = elemRect.left < cardRect.left ||
            elemRect.right > cardRect.right ||
            elemRect.top < cardRect.top ||
            elemRect.bottom > cardRect.bottom;

        // If this element crosses the card boundary, check if it has an opaque background
        if (crossesBoundary) {
            const bgColor = window.getComputedStyle(element).backgroundColor;
            const hasOpaqueBackground = bgColor !== 'transparent' && bgColor !== 'rgba(0, 0, 0, 0)';

            if (hasOpaqueBackground) {
                return element;
            }
        }

        // Always recursively check children - they could extend beyond parent bounds
        // via absolute positioning, overflow, transforms, etc.
        for (const child of element.children) {
            const culprit = this.findExtendingElement(child);
            if (culprit) return culprit;
        }

        return null;
    }

    /**
     * Mark the current session as invalidated
     */
    private invalidateSession(culpritElement: Element): void {
        this.sessionInvalidated = true;
        this.stopMutationObserver();
        const rect = culpritElement.getBoundingClientRect();
        console.log('[HoveredCard] Session invalidated - overlay extends outside card boundary. Culprit:', culpritElement, 'Rect:', { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height });

        // Update debug highlight to show invalidated state
        this.updateInvalidatedLabel();
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

        // Show invalidated label if session is already invalidated
        if (this.sessionInvalidated) {
            this.updateInvalidatedLabel();
        }
    }

    /**
     * Update or create the invalidated label above the highlight
     */
    private updateInvalidatedLabel(): void {
        if (!DEBUG_SHOW_HOVERED_CARD || !this.highlightElement || !this.sessionInvalidated) {
            this.hideInvalidatedLabel();
            return;
        }

        if (!this.invalidatedLabel) {
            this.invalidatedLabel = document.createElement('div');
            this.invalidatedLabel.id = 'recordio-hovered-card-invalidated';
            this.invalidatedLabel.textContent = 'INVALIDATED';
            this.invalidatedLabel.style.cssText = `
                position: fixed;
                background: #dc2626;
                color: white;
                font-size: 12px;
                font-weight: bold;
                font-family: system-ui, sans-serif;
                padding: 4px 8px;
                border-radius: 4px;
                pointer-events: none;
                z-index: 2147483647;
            `;
            document.body.appendChild(this.invalidatedLabel);
        }

        // Position above the highlight
        const highlightRect = this.highlightElement.getBoundingClientRect();
        this.invalidatedLabel.style.left = `${highlightRect.left}px`;
        this.invalidatedLabel.style.top = `${highlightRect.top - 28}px`;
    }

    /**
     * Hide the invalidated label
     */
    private hideInvalidatedLabel(): void {
        if (this.invalidatedLabel) {
            this.invalidatedLabel.remove();
            this.invalidatedLabel = null;
        }
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
        this.hideInvalidatedLabel();
        if (this.highlightElement) {
            this.highlightElement.remove();
            this.highlightElement = null;
        }
    }
}
