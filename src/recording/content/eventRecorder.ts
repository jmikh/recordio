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
import { findElementGroup, cornerRadiusToString } from './elementGroupUtils';
import { dprScalePoint, dprScaleRect } from './dprUtils';

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
            targetRect: event.targetRect,
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
        const scaled = dprScalePoint({ x: e.clientX, y: e.clientY });
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

        const scaledPos = dprScalePoint({ x: e.clientX, y: e.clientY });
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
        const scaledPos = dprScalePoint({ x: e.clientX, y: e.clientY });

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
                targetRect: dprScaleRect(targetRect),
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
        }

        // Compute the visual target element for the overlay
        let rectElement: Element | null = null;
        if (activeEl) {
            // Find the first ancestor with border or shadow, with 90% viewport fallback
            const groupResult = findElementGroup(activeEl, 0); // minSize 0 to find any matching element
            rectElement = groupResult?.element ?? activeEl;
            const elemRect = rectElement.getBoundingClientRect();

            // Check if element is offscreen (e.g., Google Docs uses hidden iframes at y: -10000)
            const isOffscreen = elemRect.bottom < 0 || elemRect.top > window.innerHeight ||
                elemRect.right < 0 || elemRect.left > window.innerWidth;

            if (isOffscreen) {
                // Element is offscreen - try to find a visible canvas (for apps like Google Docs)
                const canvases = document.querySelectorAll('canvas');
                let foundCanvas = false;
                for (const canvas of canvases) {
                    const canvasRect = canvas.getBoundingClientRect();
                    // Use the canvas if it's visible and has reasonable size
                    if (canvasRect.width > 100 && canvasRect.height > 100 &&
                        canvasRect.bottom > 0 && canvasRect.top < window.innerHeight &&
                        canvasRect.right > 0 && canvasRect.left < window.innerWidth) {
                        rectElement = canvas;
                        foundCanvas = true;
                        break;
                    }
                }
                // If no visible canvas found, don't show overlay
                if (!foundCanvas) {
                    rectElement = null;
                }
            } else if (elemRect.width > window.innerWidth * 0.9 && rectElement !== activeEl) {
                rectElement = activeEl;
            }
        }

        if (!this.currentTypingSession && isTypingActive && activeEl) {
            // Start Session
            let targetRect: Rect;

            if (useViewportRect) {
                targetRect = dprScaleRect({
                    x: 0,
                    y: 0,
                    width: window.innerWidth,
                    height: window.innerHeight
                });
            } else {
                const elemRect = rectElement!.getBoundingClientRect();
                targetRect = dprScaleRect({ x: elemRect.left, y: elemRect.top, width: elemRect.width, height: elemRect.height });
            }

            this.currentTypingSession = {
                startTime: now,
                targetRect,
                element: activeEl
            };
        }

        // Always update the active element overlay (regardless of typing)
        this.updateActiveElementOverlay(rectElement);
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


    private updateActiveElementOverlay(targetEl: Element | null) {
        if (!DEBUG_SHOW_ACTIVE_ELEMENT) {
            return;
        }
        // Hide overlay if no target element
        if (!targetEl) {
            this.hideActiveElementOverlay();
            return;
        }

        const rect = targetEl.getBoundingClientRect();

        // Hide if element has no visible dimensions
        if (rect.width === 0 || rect.height === 0) {
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
        const groupResult = findElementGroup(targetEl, 0);
        const effectiveRadius = groupResult?.effectiveRadius ?? [0, 0, 0, 0];
        this.activeElementOverlay.style.borderRadius = cornerRadiusToString(effectiveRadius, padding);
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
