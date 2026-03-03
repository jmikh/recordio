/**
 * User event types shared between extension and webapp.
 * These are recorded during screen capture.
 */

import type { Point, Rect } from './core';

export const EventType = {
    CLICK: 'click',
    MOUSEPOS: 'mousepos',
    URLCHANGE: 'urlchange',
    KEYDOWN: 'keydown',
    HOVER: 'hover',
    MOUSEDRAG: 'mousedrag',
    SCROLL: 'scroll',
    TYPING: 'typing',
    HOVERED_CARD: 'hoveredCard'
} as const;

export type EventType = typeof EventType[keyof typeof EventType];

export interface BaseEvent {
    type: EventType;
    timestamp: number;
    mousePos: Point;
    targetRect?: Rect;
    endTime?: number;
}

// KeyboardEvent has unique fields beyond BaseEvent
export interface KeyboardEvent extends BaseEvent {
    type: typeof EventType.KEYDOWN;
    key: string;
    code: string;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    tagName?: string;
}

// HoveredCardEvent has unique cornerRadius field
export interface HoveredCardEvent extends BaseEvent {
    type: typeof EventType.HOVERED_CARD;
    targetRect: Rect;
    endTime: number;
    cornerRadius: [number, number, number, number]; // [tl, tr, br, bl]
}

/**
 * Represents a drag action.
 */
export interface DragEvent extends BaseEvent {
    type: typeof EventType.MOUSEDRAG;
    endTime: number;
}

export interface UrlChangeEvent extends BaseEvent {
    type: typeof EventType.URLCHANGE;
    url: string; // window.location.href at time of navigation
}

/**
 * User interaction events recorded during screen capture.
 */
export interface UserEvents {
    mouseClicks: BaseEvent[];
    mousePositions: BaseEvent[];
    keyboardEvents: KeyboardEvent[];
    drags: DragEvent[];
    scrolls: BaseEvent[];
    typingEvents: BaseEvent[];
    urlChanges: UrlChangeEvent[];
    hoveredCards: HoveredCardEvent[];
}
