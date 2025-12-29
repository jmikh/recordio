import { EventType, type MousePositionEvent, type Rect, type Size } from '../core/types';
import { MSG_TYPES, type BaseMessage } from '../shared/messageTypes';
import { logger } from '../utils/logger';

export class ContentRecorder {
    private isRecording = false;
    private startTime = 0;

    // State for various event types
    private lastMousePos: MousePositionEvent = {
        type: EventType.MOUSEPOS,
        timestamp: 0,
        mousePos: { x: 0, y: 0 }
    };
    private lastMouseTime = 0;
    private lastKeystrokeTime = 0;

    // Typing Session State
    private currentTypingSession: { startTime: number; targetRect: Rect; element: HTMLElement } | null = null;

    // Drag State
    private bufferedMouseDown: { event: any, timestamp: number } | null = null;
    private dragPath: MousePositionEvent[] = [];

    // Constants
    private readonly MOUSE_POLL_INTERVAL = 100;
    private readonly CLICK_THRESHOLD = 500;
    private readonly DRAG_DISTANCE_THRESHOLD = 5;

    // Intervals
    private mousePollInterval: any = null;
    private typingPollInterval: any = null;

    constructor(startTime: number) {
        this.startTime = startTime;
        this.start();
    }

    private start() {
        if (this.isRecording) return;
        this.isRecording = true;
        this.attachListeners();
        this.startPolling();
        logger.log("[ContentRecorder] Started capturing events.");
    }

    public stop() {
        if (!this.isRecording) return;
        this.isRecording = false;
        this.removeListeners();
        this.stopPolling();
        logger.log("[ContentRecorder] Stopped capturing events.");
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

        // Initial URL event
        this.sendUrlEvent();
    }

    private removeListeners() {
        document.removeEventListener('mousemove', this.handleMouseMove, { capture: true });
        document.removeEventListener('pointerdown', this.handlePointerDown, { capture: true });
        document.removeEventListener('pointerup', this.handlePointerUp, { capture: true });
        window.removeEventListener('keydown', this.handleKeyDown, { capture: true });
        window.removeEventListener('scroll', this.handleScroll, { capture: true });

        window.removeEventListener('popstate', this.handleUrlChange);
        window.removeEventListener('hashchange', this.handleUrlChange);
    }

    private startPolling() {
        this.mousePollInterval = setInterval(this.pollMouse, this.MOUSE_POLL_INTERVAL);
        this.typingPollInterval = setInterval(this.pollTyping, 400);
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

    private sendMessage(type: string, payload: any) {
        if (!this.isActive()) return; // Strict active check

        if (!chrome.runtime?.id) return;

        // Wrap in CAPTURE_USER_EVENT structure
        // Wrap in CAPTURE_USER_EVENT structure
        const message: BaseMessage = {
            type: MSG_TYPES.CAPTURE_USER_EVENT,
            payload: {
                ...payload,
                // sessionId is inferred by background/offscreen context usually
                timestamp: Date.now(),
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

        const target = e.target as HTMLElement;
        const tagName = target.tagName;
        const isContentEditable = target.isContentEditable;

        let isInput = isContentEditable || tagName === 'TEXTAREA';
        if (tagName === 'INPUT') {
            const type = (target as HTMLInputElement).type;
            const nonTextInputs = ['checkbox', 'radio', 'button', 'image', 'submit', 'reset', 'range', 'color'];
            if (!nonTextInputs.includes(type)) isInput = true;
        }

        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

        const isModifier = e.ctrlKey || e.metaKey || e.altKey;
        const isSpecial = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete'].includes(e.key);

        if (isInput) this.lastKeystrokeTime = Date.now();

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

        // Simple throttle logic could be added here if needed, but we rely on browser event scheduling + explicit checks
        const now = this.getRelativeTime();

        let targetRect: Rect;
        if (e.target instanceof Element) {
            const rect = e.target.getBoundingClientRect();
            targetRect = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
        } else {
            // Full Page (simplification for now, assuming window scroll)
            targetRect = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
        }

        this.sendMessage(EventType.SCROLL, {
            timestamp: now,
            mousePos: this.lastMousePos.mousePos,
            targetRect: this.dprScaleRect(targetRect)
        });
    }

    private handleUrlChange = () => {
        this.sendUrlEvent();
    }

    private sendUrlEvent() {
        this.sendMessage(EventType.URLCHANGE, {
            timestamp: this.getRelativeTime(),
            mousePos: this.lastMousePos.mousePos,
            url: window.location.href
        });
    }

    // --- Pollers ---

    private pollMouse = () => {
        if (!this.isActive()) return;

        const now = this.getRelativeTime();
        const realNow = Date.now();

        if (realNow - this.lastMouseTime >= this.MOUSE_POLL_INTERVAL) {
            this.lastMouseTime = realNow;
            this.sendMessage(EventType.MOUSEPOS, {
                ...this.lastMousePos,
                timestamp: now
            });

            if (this.bufferedMouseDown) {
                this.dragPath.push({
                    type: EventType.MOUSEPOS,
                    mousePos: this.lastMousePos.mousePos,
                    timestamp: now
                });
            }
        }
    }

    private pollTyping = () => {
        if (!this.isActive()) return;

        const realNow = Date.now();
        const now = this.getRelativeTime();
        const activeEl = document.activeElement as HTMLElement; // Simplified active element check

        // Check if editable
        const tagName = activeEl?.tagName;
        const isContentEditable = activeEl?.isContentEditable;
        let isEditable = isContentEditable || tagName === 'TEXTAREA';
        if (tagName === 'INPUT') {
            const type = (activeEl as HTMLInputElement).type;
            const nonTextInputs = ['checkbox', 'radio', 'button', 'image', 'submit', 'reset', 'range', 'color'];
            if (!nonTextInputs.includes(type)) isEditable = true;
        }

        if (!activeEl || !isEditable) return;

        let isTypingActive = false;
        const isTyping = (realNow - this.lastKeystrokeTime) < 1000;

        if (isTyping) isTypingActive = true;

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
        } else if (isTypingActive) {
            // Start Session
            const rect = activeEl.getBoundingClientRect();
            this.currentTypingSession = {
                startTime: now,
                targetRect: this.dprScaleRect({ x: rect.left, y: rect.top, width: rect.width, height: rect.height }),
                element: activeEl
            };
        }
    }
}
