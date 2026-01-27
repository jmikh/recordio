/**
 * @fileoverview Event Recorder for Content Script
 * 
 * Captures user interaction events in recorded tabs:
 * - Mouse: clicks, movements (polled), drags
 * - Keyboard: keydown events (excluding password fields)
 * - Scroll: scroll events with target element rect
 * - Typing: typing session detection with element focus tracking
 * - URL: pushState, replaceState, popstate, hashchange
 * 
 * All coordinates are scaled by devicePixelRatio for video alignment.
 * Events are sent to background via CAPTURE_USER_EVENT messages.
 */

import { EventType, type MousePositionEvent, type Rect, type Size } from '../../core/types';
import { MSG_TYPES, type BaseMessage } from '../shared/messageTypes';
import { HoveredCardDetector, type HoveredCardEvent } from './hoveredCardDetector';

// Debug flag - set to true to show purple highlight border on active element
const DEBUG_SHOW_ACTIVE_ELEMENT = true;


export class EventRecorder {
    private isRecording = false;
    private startTime = 0;

    // State for various event types
    private lastMousePos: MousePositionEvent = {
        type: EventType.MOUSEPOS,
        timestamp: 0,
        mousePos: { x: 0, y: 0 }
    };
    private lastMouseTime = 0;
    private lastKeystrokeTime = -Infinity;

    // Typing Session State
    private currentTypingSession: { startTime: number; targetRect: Rect; element: HTMLElement } | null = null;

    // Active Element Overlay (always visible on focused element)
    private activeElementOverlay: HTMLDivElement | null = null;

    // Hovered Card Detection
    private hoveredCardDetector: HoveredCardDetector;

    // Scroll Session State
    private currentScrollSession: { startTime: number; targetRect: Rect; lastScrollTime: number } | null = null;

    // Drag State
    private bufferedMouseDown: { event: any, timestamp: number } | null = null;
    private dragPath: MousePositionEvent[] = [];

    // Constants
    private readonly MOUSE_POLL_INTERVAL = 100;
    private readonly TYPING_POLL_INTERVAL = 100;
    private readonly CLICK_THRESHOLD = 500;
    private readonly DRAG_DISTANCE_THRESHOLD = 5;
    private readonly SCROLL_SESSION_TIMEOUT = 1000;

    // Intervals
    private mousePollInterval: any = null;
    private typingPollInterval: any = null;

    constructor(startTime: number) {
        this.startTime = startTime;
        this.hoveredCardDetector = new HoveredCardDetector((event) => this.handleHoveredCardEvent(event));
        this.start();
    }

    private handleHoveredCardEvent(event: HoveredCardEvent): void {
        // Send hovered card event to background
        this.sendMessage(EventType.HOVERED_CARD, {
            timestamp: event.startTime - this.startTime,
            endTime: event.endTime - this.startTime,
            rect: event.rect,
            cornerRadius: event.cornerRadius,
        }, true);
    }

    private start() {
        if (this.isRecording) return;
        this.isRecording = true;
        this.attachListeners();
        this.startPolling();
        this.hoveredCardDetector.start();
        console.log("[ContentRecorder] Started capturing events.");
    }

    public stop() {
        if (!this.isRecording) return;
        this.isRecording = false;
        this.flushPendingTypingSession();
        this.flushPendingScrollSession();
        this.hoveredCardDetector.stop();
        this.hideActiveElementOverlay();
        this.removeListeners();
        this.stopPolling();
        console.log("[ContentRecorder] Stopped capturing events.");
    }

    private getRelativeTime(): number {
        return Math.max(0, Date.now() - this.startTime);
    }

    private attachListeners() {
        // Use 'true' for capture phase where appropriate to mirror original logic
        document.addEventListener('mousemove', this.handleMouseMove, { capture: true });
        document.addEventListener('pointerdown', this.handlePointerDown, { capture: true });
        document.addEventListener('pointerup', this.handlePointerUp, { capture: true });
        window.addEventListener('keydown', this.handleKeyDown, { capture: true });
        window.addEventListener('scroll', this.handleScroll, { capture: true });

        // URL Changes
        window.addEventListener('popstate', this.handleUrlChange);
        window.addEventListener('hashchange', this.handleUrlChange);
        window.addEventListener('pagehide', this.handlePageUnload);

        // Focus changes (tab switching, window minimizing, etc.)
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    private removeListeners() {
        document.removeEventListener('mousemove', this.handleMouseMove, { capture: true });
        document.removeEventListener('pointerdown', this.handlePointerDown, { capture: true });
        document.removeEventListener('pointerup', this.handlePointerUp, { capture: true });
        window.removeEventListener('keydown', this.handleKeyDown, { capture: true });
        window.removeEventListener('scroll', this.handleScroll, { capture: true });

        window.removeEventListener('popstate', this.handleUrlChange);
        window.removeEventListener('hashchange', this.handleUrlChange);
        window.removeEventListener('pagehide', this.handlePageUnload);
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }

    private startPolling() {
        this.mousePollInterval = setInterval(this.pollMouse, this.MOUSE_POLL_INTERVAL);
        this.typingPollInterval = setInterval(this.pollTyping, this.TYPING_POLL_INTERVAL);
    }

    private stopPolling() {
        if (this.mousePollInterval) clearInterval(this.mousePollInterval);
        if (this.typingPollInterval) clearInterval(this.typingPollInterval);
        this.mousePollInterval = null;
        this.typingPollInterval = null;
    }

    // --- Helpers ---

    private isActive(): boolean {
        return document.hasFocus() && document.visibilityState === 'visible';
    }

    /**
     * Get the deepest active element, traversing into shadow DOMs.
     * This handles cases like LinkedIn's post composer which uses shadow DOM.
     */
    private getDeepActiveElement(): HTMLElement | null {
        let active = document.activeElement as HTMLElement | null;
        while (active?.shadowRoot?.activeElement) {
            active = active.shadowRoot.activeElement as HTMLElement;
        }
        return active;
    }

    private dprScalePoint(point: { x: number, y: number }): { x: number, y: number } {
        const dpr = window.devicePixelRatio || 1;
        return { x: point.x * dpr, y: point.y * dpr };
    }

    private dprScaleRect(rect: Rect): Rect {
        const dpr = window.devicePixelRatio || 1;
        return {
            x: rect.x * dpr,
            y: rect.y * dpr,
            width: rect.width * dpr,
            height: rect.height * dpr
        };
    }

    private sendMessage(type: string, payload: any, skipActiveCheck = false) {
        if (!skipActiveCheck && !this.isActive()) return; // Strict active check

        if (!chrome.runtime?.id) return;

        // Wrap in CAPTURE_USER_EVENT structure
        const message: BaseMessage = {
            type: MSG_TYPES.CAPTURE_USER_EVENT,
            payload: {
                ...payload,
                type // Add specific event type to payload as expected by background
            }
        };

        chrome.runtime.sendMessage(message).catch(() => { });
    }

    // --- Event Handlers ---

    private handleMouseMove = (e: MouseEvent) => {
        if (!this.isActive()) return;
        const scaled = this.dprScalePoint({ x: e.clientX, y: e.clientY });
        this.lastMousePos = {
            type: EventType.MOUSEPOS,
            timestamp: this.getRelativeTime(),
            mousePos: scaled
        };
    }

    private handlePointerDown = (e: PointerEvent) => {
        if (!this.isActive()) return;

        // Interaction should flush pending scroll
        this.flushPendingScrollSession();

        const dpr = window.devicePixelRatio || 1;
        let elementMeta: Partial<Size> = {};
        if (e.target instanceof Element) {
            const rect = e.target.getBoundingClientRect();
            elementMeta = { width: rect.width * dpr, height: rect.height * dpr };
        }

        const scaledPos = this.dprScalePoint({ x: e.clientX, y: e.clientY });
        const now = this.getRelativeTime();

        this.bufferedMouseDown = {
            event: {
                mousePos: scaledPos,
                ...elementMeta,
            },
            timestamp: now
        };

        this.dragPath = [{
            type: EventType.MOUSEPOS,
            mousePos: scaledPos,
            timestamp: now
        }];
    }

    private handlePointerUp = (e: PointerEvent) => {
        if (!this.bufferedMouseDown) return;

        const now = this.getRelativeTime();
        const diff = now - this.bufferedMouseDown.timestamp;
        const scaledPos = this.dprScalePoint({ x: e.clientX, y: e.clientY });

        const startPt = this.dragPath[0].mousePos;
        const dx = scaledPos.x - startPt.x;
        const dy = scaledPos.y - startPt.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (diff <= this.CLICK_THRESHOLD && dist < this.DRAG_DISTANCE_THRESHOLD) {
            this.sendMessage(EventType.CLICK, {
                ...this.bufferedMouseDown.event,
                timestamp: this.bufferedMouseDown.timestamp
            });
        } else {
            this.dragPath.push({
                type: EventType.MOUSEPOS,
                mousePos: scaledPos,
                timestamp: now
            });
            this.sendMessage(EventType.MOUSEDRAG, {
                timestamp: this.bufferedMouseDown.timestamp,
                mousePos: this.bufferedMouseDown.event.mousePos,
                path: this.dragPath,
                endTime: now
            });
        }

        this.bufferedMouseDown = null;
        this.dragPath = [];
    }

    private handleKeyDown = (e: KeyboardEvent) => {
        if (!this.isActive()) return;

        // Interaction should flush pending scroll
        this.flushPendingScrollSession();

        // Use composedPath to get actual target (handles shadow DOM)
        const target = (e.composedPath()[0] || e.target) as HTMLElement;
        const tagName = target.tagName;
        const isContentEditable = target.isContentEditable;

        // Check for ARIA roles that indicate text input (e.g., Reddit's search uses role="combobox")
        const role = target.getAttribute('role');
        const textInputRoles = ['textbox', 'combobox', 'searchbox'];
        const hasTextInputRole = role && textInputRoles.includes(role);

        let isInput = isContentEditable || tagName === 'TEXTAREA' || hasTextInputRole;
        if (tagName === 'INPUT') {
            const type = (target as HTMLInputElement).type;
            const nonTextInputs = ['checkbox', 'radio', 'button', 'image', 'submit', 'reset', 'range', 'color'];
            if (!nonTextInputs.includes(type)) isInput = true;
        }

        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

        const isModifier = e.ctrlKey || e.metaKey || e.altKey;
        const isSpecial = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete'].includes(e.key);

        if (isInput) this.lastKeystrokeTime = this.getRelativeTime();

        const shouldCapture = !isInput || (isInput && (isModifier || isSpecial));

        if (shouldCapture) {
            if (target && target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'password') return;

            this.sendMessage(EventType.KEYDOWN, {
                timestamp: this.getRelativeTime(),
                mousePos: this.lastMousePos.mousePos,
                key: e.key,
                code: e.code,
                ctrlKey: e.ctrlKey,
                metaKey: e.metaKey,
                shiftKey: e.shiftKey,
                altKey: e.altKey,
                isInput,
                isModifier,
                isSpecial,
            });
        }
    }

    private handleScroll = (e: Event) => {
        if (!this.isActive()) return;

        const now = this.getRelativeTime();

        // If this is a new session or continuation
        if (!this.currentScrollSession) {
            let targetRect: Rect;
            if (e.target instanceof Element) {
                const rect = e.target.getBoundingClientRect();
                targetRect = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
            } else {
                targetRect = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
            }

            this.currentScrollSession = {
                startTime: now,
                targetRect: this.dprScaleRect(targetRect),
                lastScrollTime: now
            };
        } else {
            // Update last scroll time
            this.currentScrollSession.lastScrollTime = now;
        }
    }

    private handleUrlChange = () => {
        this.flushPendingScrollSession();
        this.sendUrlEvent();
    }

    private handlePageUnload = () => {
        this.flushPendingTypingSession();
        this.flushPendingScrollSession();
    }

    private handleVisibilityChange = () => {
        // Send URL event on both focus gain and focus loss
        this.flushPendingScrollSession();
        this.sendUrlEvent();
    }

    private sendUrlEvent() {
        this.sendMessage(EventType.URLCHANGE, {
            timestamp: this.getRelativeTime(),
            mousePos: this.lastMousePos.mousePos,
            url: window.location.href
        }, true);
    }

    // --- Pollers ---

    private lastSentMousePos: { x: number, y: number } | null = null;

    private pollMouse = () => {
        if (!this.isActive()) return;

        const now = this.getRelativeTime();
        const realNow = Date.now();

        // Check Scroll Session Timeout
        if (this.currentScrollSession) {
            if (now - this.currentScrollSession.lastScrollTime > this.SCROLL_SESSION_TIMEOUT) {
                this.flushPendingScrollSession();
            }
        }

        if (realNow - this.lastMouseTime >= this.MOUSE_POLL_INTERVAL) {
            this.lastMouseTime = realNow;
            const currentPos = this.lastMousePos.mousePos;

            // Only send if position changed
            if (!this.lastSentMousePos ||
                currentPos.x !== this.lastSentMousePos.x ||
                currentPos.y !== this.lastSentMousePos.y) {

                this.sendMessage(EventType.MOUSEPOS, {
                    ...this.lastMousePos,
                    timestamp: now
                });
                this.lastSentMousePos = currentPos;
            }

            if (this.bufferedMouseDown) {
                // For drag path, we also want to avoid duplicates
                const lastPathPoint = this.dragPath.length > 0 ? this.dragPath[this.dragPath.length - 1] : null;

                if (!lastPathPoint ||
                    lastPathPoint.mousePos.x !== currentPos.x ||
                    lastPathPoint.mousePos.y !== currentPos.y) {

                    this.dragPath.push({
                        type: EventType.MOUSEPOS,
                        mousePos: currentPos,
                        timestamp: now
                    });
                }
            }
        }
    }

    private pollTyping = () => {
        if (!this.isActive()) return;

        const now = this.getRelativeTime();
        const activeEl = this.getDeepActiveElement();

        // Check if editable
        const tagName = activeEl?.tagName;
        const isContentEditable = activeEl?.isContentEditable;

        // Check for ARIA roles that indicate text input (e.g., Reddit's search uses role="combobox")
        const role = activeEl?.getAttribute?.('role');
        const textInputRoles = ['textbox', 'combobox', 'searchbox'];
        const hasTextInputRole = role && textInputRoles.includes(role);

        let isEditable = isContentEditable || tagName === 'TEXTAREA' || hasTextInputRole;
        if (tagName === 'INPUT') {
            const type = (activeEl as HTMLInputElement).type;
            const nonTextInputs = ['checkbox', 'radio', 'button', 'image', 'submit', 'reset', 'range', 'color'];
            if (!nonTextInputs.includes(type)) isEditable = true;
        }

        // Detect hidden text capture iframes (Google Docs, etc.) and canvas editors
        // These use offscreen iframes/elements for keyboard capture while rendering elsewhere
        let useViewportRect = false;
        if (tagName === 'IFRAME' || tagName === 'CANVAS') {
            isEditable = true;
            useViewportRect = true;
        }

        // For iframes/canvas, we can't detect keystrokes (they happen inside the iframe)
        // So we treat focus itself as "typing active" for these elements
        const isTyping = (now - this.lastKeystrokeTime) < 1000;
        const isTypingActive = useViewportRect ? isEditable : (isTyping && isEditable);

        if (this.currentTypingSession) {
            if (!isTypingActive || activeEl !== this.currentTypingSession.element) {
                // End Session
                this.sendMessage(EventType.TYPING, {
                    timestamp: this.currentTypingSession.startTime,
                    mousePos: this.lastMousePos.mousePos,
                    targetRect: this.currentTypingSession.targetRect,
                    endTime: now
                });
                this.currentTypingSession = null;
            }
        } else if (isTypingActive && activeEl) {
            // Start Session
            let targetRect: Rect;

            if (useViewportRect) {
                // For canvas-based editors with offscreen input elements, use viewport
                targetRect = this.dprScaleRect({
                    x: 0,
                    y: 0,
                    width: window.innerWidth,
                    height: window.innerHeight
                });
            } else {
                // Find the first ancestor with border or shadow, with 90% viewport fallback
                let rectElement: Element = this.findVisualBorderAncestor(activeEl) ?? activeEl;
                let elemRect = rectElement.getBoundingClientRect();
                if (elemRect.width > window.innerWidth * 0.9 && rectElement !== activeEl) {
                    rectElement = activeEl;
                    elemRect = rectElement.getBoundingClientRect();
                }
                targetRect = this.dprScaleRect({ x: elemRect.left, y: elemRect.top, width: elemRect.width, height: elemRect.height });
            }

            this.currentTypingSession = {
                startTime: now,
                targetRect,
                element: activeEl
            };
        }

        // Always update the active element overlay (regardless of typing)
        this.updateActiveElementOverlay(activeEl);
    }

    private flushPendingTypingSession() {
        if (this.currentTypingSession) {
            const now = this.getRelativeTime();
            this.sendMessage(EventType.TYPING, {
                timestamp: this.currentTypingSession.startTime,
                mousePos: this.lastMousePos.mousePos,
                targetRect: this.currentTypingSession.targetRect,
                endTime: now
            }, true);
            this.currentTypingSession = null;
        }
    }

    /**
     * Get adjusted border radius from an element, reading individual corners.
     * Also checks clip-path: inset(... round X) as a fallback.
     */
    private getAdjustedBorderRadius(element: Element, padding: number): string {
        const style = window.getComputedStyle(element);

        // Read individual corner radii (these always resolve CSS variables properly)
        let tl = parseFloat(style.borderTopLeftRadius) || 0;
        let tr = parseFloat(style.borderTopRightRadius) || 0;
        let br = parseFloat(style.borderBottomRightRadius) || 0;
        let bl = parseFloat(style.borderBottomLeftRadius) || 0;

        // If no border-radius, check clip-path for inset(...round X) pattern
        if (tl === 0 && tr === 0 && br === 0 && bl === 0) {
            const clipPath = style.clipPath;
            if (clipPath && clipPath.includes('round')) {
                // Parse: inset(0px round 32px) or inset(0 round 10px 20px 30px 40px)
                const roundMatch = clipPath.match(/round\s+([\d.]+)(?:px)?\s*([\d.]+)?(?:px)?\s*([\d.]+)?(?:px)?\s*([\d.]+)?(?:px)?/);
                if (roundMatch) {
                    const r1 = parseFloat(roundMatch[1]) || 0;
                    const r2 = roundMatch[2] ? parseFloat(roundMatch[2]) : r1;
                    const r3 = roundMatch[3] ? parseFloat(roundMatch[3]) : r1;
                    const r4 = roundMatch[4] ? parseFloat(roundMatch[4]) : r2;
                    // CSS border-radius order: top-left, top-right, bottom-right, bottom-left
                    tl = r1;
                    tr = r2;
                    br = r3;
                    bl = r4;
                }
            }
        }

        // Add padding to each corner to maintain the curve
        return `${tl + padding}px ${tr + padding}px ${br + padding}px ${bl + padding}px`;
    }

    /**
     * Find the first ancestor (including the element itself) that has a visible border or shadow.
     * Walks up the DOM tree and returns the first element with:
     * - Border on any side (top, right, bottom, left)
     * - Box shadow
     * - Drop shadow (via filter)
     */
    private findVisualBorderAncestor(element: Element): Element | null {
        let current: Element | null = element;

        while (current && current !== document.body && current !== document.documentElement) {
            const style = window.getComputedStyle(current);

            // Helper to check if a color is not fully transparent
            const isVisibleColor = (color: string): boolean => {
                if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return false;
                // Check for rgba with 0 alpha
                const rgbaMatch = color.match(/rgba\([^)]+,\s*([\d.]+)\s*\)/);
                if (rgbaMatch && parseFloat(rgbaMatch[1]) === 0) return false;
                return true;
            };

            // Check for border on any side (must have width > 0, style != none, and visible color)
            const hasBorderTop = parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== 'none' && isVisibleColor(style.borderTopColor);
            const hasBorderRight = parseFloat(style.borderRightWidth) > 0 && style.borderRightStyle !== 'none' && isVisibleColor(style.borderRightColor);
            const hasBorderBottom = parseFloat(style.borderBottomWidth) > 0 && style.borderBottomStyle !== 'none' && isVisibleColor(style.borderBottomColor);
            const hasBorderLeft = parseFloat(style.borderLeftWidth) > 0 && style.borderLeftStyle !== 'none' && isVisibleColor(style.borderLeftColor);
            const hasBorder = hasBorderTop || hasBorderRight || hasBorderBottom || hasBorderLeft;

            // Check for box shadow
            const hasBoxShadow = style.boxShadow && style.boxShadow !== 'none';

            // Check for drop shadow (via filter)
            const hasDropShadow = style.filter && style.filter.includes('drop-shadow');

            if (hasBorder || hasBoxShadow || hasDropShadow) {
                return current;
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

        return null;
    }

    private updateActiveElementOverlay(activeEl: HTMLElement | null) {
        // Hide overlay if no active element or if it's the body/html
        if (!activeEl || activeEl === document.body || activeEl === document.documentElement) {
            this.hideActiveElementOverlay();
            return;
        }

        // Find the first ancestor with border or shadow
        let targetEl: Element = this.findVisualBorderAncestor(activeEl) ?? activeEl;

        let rect = targetEl.getBoundingClientRect();

        // If the found element is too wide (> 90% viewport), fall back to active element
        if (rect.width > window.innerWidth * 0.9 && targetEl !== activeEl) {
            targetEl = activeEl;
            rect = targetEl.getBoundingClientRect();
        }

        // Hide if element has no visible dimensions
        if (rect.width === 0 || rect.height === 0) {
            this.hideActiveElementOverlay();
            return;
        }

        // Create or update overlay (only if debug flag is enabled)
        if (!DEBUG_SHOW_ACTIVE_ELEMENT) {
            this.hideActiveElementOverlay();
            return;
        }

        if (!this.activeElementOverlay) {
            this.activeElementOverlay = document.createElement('div');
            this.activeElementOverlay.id = 'recordio-active-element-overlay';
            this.activeElementOverlay.style.cssText = `
                position: fixed;
                background: transparent;
                pointer-events: none;
                z-index: 2147483647;
                box-sizing: border-box;
                transition: all 0.1s ease-out;
                border: 2px solid #8b5cf6;
            `;
            document.body.appendChild(this.activeElementOverlay);
        }

        // Update position (expand by 5px in all directions)
        const padding = 5;
        this.activeElementOverlay.style.left = `${rect.left - padding}px`;
        this.activeElementOverlay.style.top = `${rect.top - padding}px`;
        this.activeElementOverlay.style.width = `${rect.width + padding * 2}px`;
        this.activeElementOverlay.style.height = `${rect.height + padding * 2}px`;

        // Match border-radius of the target element (add padding to maintain curve)
        this.activeElementOverlay.style.borderRadius = this.getAdjustedBorderRadius(targetEl, padding);
    }

    private hideActiveElementOverlay() {
        if (this.activeElementOverlay) {
            this.activeElementOverlay.remove();
            this.activeElementOverlay = null;
        }
    }



    private flushPendingScrollSession() {
        if (this.currentScrollSession) {
            this.sendMessage(EventType.SCROLL, {
                timestamp: this.currentScrollSession.startTime,
                mousePos: this.lastMousePos.mousePos,
                targetRect: this.currentScrollSession.targetRect,
                endTime: this.currentScrollSession.lastScrollTime
            }, true);
            this.currentScrollSession = null;
        }
    }
}
