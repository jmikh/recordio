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
    private dragStartPos: { x: number; y: number } | null = null;

    // Constants
    private readonly CLICK_THRESHOLD = 500;
    private readonly DRAG_DISTANCE_THRESHOLD = 5;
    private readonly SCROLL_SESSION_TIMEOUT = 1000;

    // Scroll session timeout handle
    private scrollSessionTimeout: ReturnType<typeof setTimeout> | null = null;

    // Focusout handler for current typing session
    private typingFocusOutHandler: (() => void) | null = null;

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
        this.hoveredCardDetector.start();
        console.log("[ContentRecorder] Started capturing events.");
    }

    public stop() {
        if (!this.isRecording) return;
        this.isRecording = false;
        this.flushPendingTypingSession();
        this.flushPendingScrollSession();
        this.hoveredCardDetector.stop();
        this.hideTypingOverlay();
        this.removeListeners();
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



    // --- Helpers ---

    private isActive(): boolean {
        return document.hasFocus() && document.visibilityState === 'visible';
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
        const now = this.getRelativeTime();
        const scaled = dprScalePoint({ x: e.clientX, y: e.clientY });

        this.lastMousePos = {
            type: EventType.MOUSEPOS,
            timestamp: now,
            mousePos: scaled
        };

        this.sendMessage(EventType.MOUSEPOS, this.lastMousePos);
    }

    private handlePointerDown = (e: PointerEvent) => {
        if (!this.isActive()) return;

        // Interaction should flush pending sessions
        this.flushPendingTypingSession();
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

        this.dragStartPos = scaledPos;
    }

    private handlePointerUp = (e: PointerEvent) => {
        if (!this.bufferedMouseDown || !this.dragStartPos) return;

        const now = this.getRelativeTime();
        const diff = now - this.bufferedMouseDown.timestamp;
        const scaledPos = dprScalePoint({ x: e.clientX, y: e.clientY });

        const dx = scaledPos.x - this.dragStartPos.x;
        const dy = scaledPos.y - this.dragStartPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (diff <= this.CLICK_THRESHOLD && dist < this.DRAG_DISTANCE_THRESHOLD) {
            this.sendMessage(EventType.CLICK, {
                ...this.bufferedMouseDown.event,
                timestamp: this.bufferedMouseDown.timestamp
            });
        } else {
            this.sendMessage(EventType.MOUSEDRAG, {
                timestamp: this.bufferedMouseDown.timestamp,
                mousePos: this.bufferedMouseDown.event.mousePos,
                endTime: now
            });
        }

        this.bufferedMouseDown = null;
        this.dragStartPos = null;
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

        // Detect hidden text capture iframes (Google Docs, etc.) and canvas editors
        let useViewportRect = false;
        if (tagName === 'IFRAME' || tagName === 'CANVAS') {
            isInput = true;
            useViewportRect = true;
        }

        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

        const isModifier = e.ctrlKey || e.metaKey || e.altKey;
        const isSpecial = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete'].includes(e.key);

        // Start typing session if in an input and not already in a session
        if (isInput && !this.currentTypingSession) {
            this.startTypingSession(target, useViewportRect);
        }

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

        // Scrolling should flush pending typing session
        this.flushPendingTypingSession();

        const now = this.getRelativeTime();

        // Clear existing timeout and set a new one
        if (this.scrollSessionTimeout) {
            clearTimeout(this.scrollSessionTimeout);
        }
        this.scrollSessionTimeout = setTimeout(() => {
            this.flushPendingScrollSession();
        }, this.SCROLL_SESSION_TIMEOUT);

        // Compute target rect for this scroll event
        let targetRect: Rect;
        if (e.target instanceof Element) {
            const rect = e.target.getBoundingClientRect();
            targetRect = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
        } else {
            targetRect = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
        }
        const scaledTargetRect = dprScaleRect(targetRect);

        // Check if scroll target changed - flush old session and start new one
        if (this.currentScrollSession) {
            const current = this.currentScrollSession.targetRect;
            const targetChanged = current.x !== scaledTargetRect.x ||
                current.y !== scaledTargetRect.y ||
                current.width !== scaledTargetRect.width ||
                current.height !== scaledTargetRect.height;
            if (targetChanged) {
                this.flushPendingScrollSession();
            }
        }

        // Start new session or continue existing one
        if (!this.currentScrollSession) {
            this.currentScrollSession = {
                startTime: now,
                targetRect: scaledTargetRect,
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
        this.flushPendingTypingSession();
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

    // --- Typing Session Management ---

    private startTypingSession(element: HTMLElement, useViewportRect: boolean) {
        const now = this.getRelativeTime();

        // Compute the visual target element for the overlay
        let rectElement: Element = element;

        // Find the first ancestor with border or shadow, with 90% viewport fallback
        const groupResult = findElementGroup(element, 0); // minSize 0 to find any matching element
        rectElement = groupResult?.element ?? element;
        const elemRect = rectElement.getBoundingClientRect();

        // Check if element is offscreen (e.g., Google Docs uses hidden iframes at y: -10000)
        const isOffscreen = elemRect.bottom < 0 || elemRect.top > window.innerHeight ||
            elemRect.right < 0 || elemRect.left > window.innerWidth;

        if (isOffscreen) {
            // Element is offscreen - try to find a visible canvas (for apps like Google Docs)
            const canvases = document.querySelectorAll('canvas');
            for (const canvas of canvases) {
                const canvasRect = canvas.getBoundingClientRect();
                // Use the canvas if it's visible and has reasonable size
                if (canvasRect.width > 100 && canvasRect.height > 100 &&
                    canvasRect.bottom > 0 && canvasRect.top < window.innerHeight &&
                    canvasRect.right > 0 && canvasRect.left < window.innerWidth) {
                    rectElement = canvas;
                    break;
                }
            }
        } else if (elemRect.width > window.innerWidth * 0.9 && rectElement !== element) {
            rectElement = element;
        }

        // Compute target rect
        let targetRect: Rect;
        if (useViewportRect) {
            targetRect = dprScaleRect({
                x: 0,
                y: 0,
                width: window.innerWidth,
                height: window.innerHeight
            });
        } else {
            const finalRect = rectElement.getBoundingClientRect();
            targetRect = dprScaleRect({ x: finalRect.left, y: finalRect.top, width: finalRect.width, height: finalRect.height });
        }

        // Set up focusout handler on this specific element
        this.typingFocusOutHandler = () => {
            this.flushPendingTypingSession();
        };
        element.addEventListener('focusout', this.typingFocusOutHandler, { once: true });

        this.currentTypingSession = {
            startTime: now,
            targetRect,
            element
        };

        // Show debug overlay
        this.showTypingOverlay(rectElement);
    }

    private flushPendingTypingSession() {
        if (this.currentTypingSession) {
            const now = this.getRelativeTime();

            // Remove focusout listener if still attached
            if (this.typingFocusOutHandler) {
                this.currentTypingSession.element.removeEventListener('focusout', this.typingFocusOutHandler);
                this.typingFocusOutHandler = null;
            }

            this.sendMessage(EventType.TYPING, {
                timestamp: this.currentTypingSession.startTime,
                mousePos: this.lastMousePos.mousePos,
                targetRect: this.currentTypingSession.targetRect,
                endTime: now
            }, true);
            this.currentTypingSession = null;

            // Hide debug overlay
            this.hideTypingOverlay();
        }
    }


    // --- Debug Overlay (for typing session visualization) ---

    private showTypingOverlay(targetEl: Element) {
        if (!DEBUG_SHOW_ACTIVE_ELEMENT) return;

        const rect = targetEl.getBoundingClientRect();

        // Don't show if element has no visible dimensions
        if (rect.width === 0 || rect.height === 0) return;

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

    private hideTypingOverlay() {
        if (!DEBUG_SHOW_ACTIVE_ELEMENT) return;

        if (this.activeElementOverlay) {
            this.activeElementOverlay.remove();
            this.activeElementOverlay = null;
        }
    }



    private flushPendingScrollSession() {
        // Clear the timeout if still pending
        if (this.scrollSessionTimeout) {
            clearTimeout(this.scrollSessionTimeout);
            this.scrollSessionTimeout = null;
        }

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
