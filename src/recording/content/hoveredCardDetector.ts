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
import { findElementGroup, cornerRadiusToString, type ElementGroupResult } from './elementGroupUtils';
import { dprScaleRect, dprScaleRadius } from './dprUtils';

export interface HoveredCardEvent {
    type: 'hoveredCard';
    startTime: number;
    endTime: number;
    targetRect: Rect;
    cornerRadius: [number, number, number, number]; // [tl, tr, br, bl]
}

// Debug flag - set to true to show pink highlight border
const DEBUG_SHOW_HOVERED_CARD = true;

// Minimum duration (ms) for a hovered card session to be reported
const MIN_SESSION_DURATION_MS = 2000;

export class HoveredCardDetector {
    private highlightElement: HTMLDivElement | null = null;
    private currentCard: ElementGroupResult | null = null;
    private currentCardRect: DOMRect | null = null;
    private sessionStartTime: number | null = null;
    // Watches document.body subtree for new overlays extending outside card bounds (flushes session)
    private globalMutationObserver: MutationObserver | null = null;
    // Watches the card element itself for size/position changes (flushes session)
    private cardResizeObserver: ResizeObserver | null = null;
    // Timer for changing highlight color after 2 seconds
    private colorChangeTimeout: ReturnType<typeof setTimeout> | null = null;
    // Timer to detect when mouse goes over an iframe (events stop firing)
    private mouseInactivityTimeout: ReturnType<typeof setTimeout> | null = null;

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
        window.addEventListener('resize', this.detectCardAtMousePosition);

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
        window.removeEventListener('resize', this.detectCardAtMousePosition);

        if (this.mouseInactivityTimeout) {
            clearTimeout(this.mouseInactivityTimeout);
            this.mouseInactivityTimeout = null;
        }

        this.flush();
        console.log('[HoveredCardDetector] Stopped listening');
    }

    /**
     * Handle mouse move - update position and check bounds or detect card
     */
    private handleMouseMove = (e: MouseEvent): void => {
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;

        // Clear iframe inactivity check since we got a mouse event
        if (this.mouseInactivityTimeout) {
            clearTimeout(this.mouseInactivityTimeout);
            this.mouseInactivityTimeout = null;
        }

        if (this.currentCard && this.currentCardRect) {
            // Session active - just check if mouse is still within card bounds
            if (this.isMouseInCardBounds()) {
                // Still in bounds - update highlight position in case card moved
                this.updateHighlightPosition(this.currentCard, this.currentCardRect);
                return;
            }
            // Mouse left the card - flush session and fall through to detection
            this.flush();
        }

        // Get the actual deepest element (traverses into Shadow DOM)
        const composedPath = e.composedPath();
        const target = (composedPath[0] || e.target) as Element;

        // No active session or mouse left bounds - detect card at target
        this.detectCardFromTarget(target);

        // Start inactivity timer to detect when mouse enters an iframe
        // (mouse events stop firing when absorbed by cross-origin iframe)
        this.mouseInactivityTimeout = setTimeout(() => {
            this.checkIfOverIframe();
        }, 100);
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
     * Handle scroll events - only start detection when no active session
     * Position changes of active cards are detected by comparing viewport position
     */
    private handleScroll = (): void => {
        if (this.currentCard && this.currentCardRect) {
            // Active session: check if card position changed in viewport
            const currentRect = this.currentCard.element.getBoundingClientRect();
            const threshold = 1; // 1px threshold
            const positionChanged =
                Math.abs(currentRect.left - this.currentCardRect.left) > threshold ||
                Math.abs(currentRect.top - this.currentCardRect.top) > threshold;

            if (positionChanged) {
                console.log('[HoveredCard] Card viewport position changed on scroll, flushing');
                this.detectCardAtMousePosition();
            }
            // Otherwise, card is still in same position - do nothing
            return;
        }

        // No active session: start detection at mouse position
        this.detectCardAtMousePosition();
    };

    /**
     * Detect which card is at the current mouse position (for scroll/resize handlers)
     */
    private detectCardAtMousePosition = (): void => {
        this.flush();
        const target = document.elementFromPoint(this.lastMouseX, this.lastMouseY);
        if (!target) {
            return;
        }
        this.detectCardFromTarget(target);
    }

    /**
     * Detect which card contains the given target element
     */
    private detectCardFromTarget(target: Element): void {
        const result = findElementGroup(target);
        if (!result) {
            this.flush();
            return;
        }
        this.startCardSession(result);
    }

    /**
     * Start a new card session with the given result.
     * Sets up state, observers, and updates the highlight.
     */
    private startCardSession(result: ElementGroupResult): void {
        // Start new session
        this.currentCard = result;
        this.currentCardRect = result.element.getBoundingClientRect();
        this.sessionStartTime = Date.now();

        // Start observing for overlays
        this.startSessionObservers();
        console.log('[HoveredCard] Detected:', result.element);

        // Update visual highlight
        this.updateHighlight(result);
    }

    /**
     * Check if mouse is over an iframe (called after inactivity timeout).
     * When mouse enters a cross-origin iframe, mouse events stop firing.
     * Uses elementFromPoint to detect if we're over an iframe and sets up
     * the session directly with the iframe's rect (0 border radius).
     */
    private checkIfOverIframe(): void {
        // Skip if we already have an active session
        if (this.currentCard) return;

        const elementAtPoint = document.elementFromPoint(this.lastMouseX, this.lastMouseY);
        if (!elementAtPoint) return;

        // Check if the element or any ancestor is an iframe
        let current: Element | null = elementAtPoint;
        while (current && current !== document.body && current !== document.documentElement) {
            if (current.tagName === 'IFRAME') {
                console.log('[HoveredCard] Found iframe:', current);
                const iframe = current as HTMLIFrameElement;
                const iframeResult: ElementGroupResult = {
                    element: iframe,
                    effectiveRadius: [0, 0, 0, 0]
                };
                this.startCardSession(iframeResult);
                return;
            }
            current = current.parentElement;
        }
    }

    /**
     * Flush any pending session, emit event if stable for 2+ seconds,
     * stop observers, hide highlight, and clear state.
     */
    public flush(): void {
        // Stop observing when session ends
        this.stopSessionObservers();

        // Emit event if session was stable for 2+ seconds
        if (this.currentCard && this.sessionStartTime && this.currentCardRect) {
            console.log('[HoveredCard] Flushing session');

            const duration = Date.now() - this.sessionStartTime;
            if (duration >= MIN_SESSION_DURATION_MS) {
                const event: HoveredCardEvent = {
                    type: 'hoveredCard',
                    startTime: this.sessionStartTime,
                    endTime: Date.now(),
                    targetRect: dprScaleRect({
                        x: this.currentCardRect.left,
                        y: this.currentCardRect.top,
                        width: this.currentCardRect.width,
                        height: this.currentCardRect.height,
                    }),
                    cornerRadius: dprScaleRadius(this.currentCard.effectiveRadius),
                };

                console.log('[HoveredCard] Session ended:', event);
                this.onEvent(event);
            }
        }

        // Hide highlight and clear state
        this.hideHighlight();
        this.currentCard = null;
        this.currentCardRect = null;
        this.sessionStartTime = null;
    }

    /**
     * Start all session observers:
     * - globalMutationObserver: Watches document.body for overlays extending outside card
     * - cardResizeObserver: Watches the card element for size/position changes
     */
    private startSessionObservers(): void {
        this.stopSessionObservers();

        if (!this.currentCardRect || !this.currentCard) return;

        // Global mutation observer - detects overlays extending outside card bounds
        this.globalMutationObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node instanceof Element) {
                        // Skip our own UI elements
                        if (node.id?.startsWith('recordio')) continue;
                        // Check the added node and all its descendants
                        const culprit = this.findExtendingElement(node);
                        if (culprit) {
                            console.log('[HoveredCard] Overlay extends outside card, flushing session. Culprit:', culprit);
                            this.detectCardAtMousePosition();
                            return;
                        }
                    }
                }
            }
        });

        this.globalMutationObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Card resize observer - detects size/position changes on the card element itself
        const initialRect = this.currentCardRect;
        this.cardResizeObserver = new ResizeObserver(() => {
            if (!this.currentCard) return;

            const currentRect = this.currentCard.element.getBoundingClientRect();
            const threshold = 1; // 1px threshold for detecting meaningful changes

            const sizeChanged = Math.abs(currentRect.width - initialRect.width) > threshold ||
                Math.abs(currentRect.height - initialRect.height) > threshold;
            const positionChanged = Math.abs(currentRect.left - initialRect.left) > threshold ||
                Math.abs(currentRect.top - initialRect.top) > threshold;

            if (sizeChanged || positionChanged) {
                console.log('[HoveredCard] Card size/position changed, flushing session');
                this.detectCardAtMousePosition();
            }
        });

        this.cardResizeObserver.observe(this.currentCard.element);
    }

    /**
     * Stop all session observers
     */
    private stopSessionObservers(): void {
        if (this.globalMutationObserver) {
            this.globalMutationObserver.disconnect();
            this.globalMutationObserver = null;
        }
        if (this.cardResizeObserver) {
            this.cardResizeObserver.disconnect();
            this.cardResizeObserver = null;
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
     * Update the debug highlight to show the detected card
     */
    private updateHighlight(result: ElementGroupResult | null): void {
        if (!DEBUG_SHOW_HOVERED_CARD) {
            this.hideHighlight();
            return;
        }

        this.hideHighlight();

        if (!result) return;

        const rect = result.element.getBoundingClientRect();
        const padding = 5;
        const adjustedRadius = cornerRadiusToString(result.effectiveRadius, padding);

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

        // Change to orange after 2 seconds
        this.colorChangeTimeout = setTimeout(() => {
            if (this.highlightElement) {
                this.highlightElement.style.borderColor = '#f97316'; // orange
            }
        }, 2000);
    }



    /**
     * Update highlight position without recreating the element
     */
    private updateHighlightPosition(result: ElementGroupResult, rect: DOMRect): void {
        if (!DEBUG_SHOW_HOVERED_CARD || !this.highlightElement) return;

        const padding = 5;
        this.highlightElement.style.left = `${rect.left - padding}px`;
        this.highlightElement.style.top = `${rect.top - padding}px`;
        this.highlightElement.style.width = `${rect.width + padding * 2}px`;
        this.highlightElement.style.height = `${rect.height + padding * 2}px`;
        this.highlightElement.style.borderRadius = cornerRadiusToString(result.effectiveRadius, padding);
    }

    /**
     * Remove the debug highlight
     */
    private hideHighlight(): void {
        if (this.colorChangeTimeout) {
            clearTimeout(this.colorChangeTimeout);
            this.colorChangeTimeout = null;
        }
        if (this.highlightElement) {
            this.highlightElement.remove();
            this.highlightElement = null;
        }
    }
}
