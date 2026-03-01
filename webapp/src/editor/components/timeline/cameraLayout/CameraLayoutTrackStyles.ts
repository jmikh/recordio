import type { CSSProperties } from 'react';
import {
    SEGMENT_RADIUS,
    containerCursors,
    resizeHandle as sharedResizeHandle,
    dragHandleIndicator as sharedDragHandleIndicator,
    ghostLabel,
    ghostContainerBase,
    holdShapeBase,
    transitionShapeBase,
    blockBorder,
} from '../TimelineBlockStyles';

// ============================================================================
// CAMERA LAYOUT TRACK STYLES
// Copies the Zoom track visual vocabulary with a teal/cyan accent color.
// ============================================================================

export const HOLD_HEIGHT = 28;
export const MIN_BLOCK_LABEL_WIDTH_PX = 40;
export const DRAG_HANDLE_HEIGHT = 32;
export { SEGMENT_RADIUS };

// ============= SHAPE HELPERS =============

function transitionInShape(): CSSProperties {
    return {
        ...transitionShapeBase(HOLD_HEIGHT),
        borderRadius: `${SEGMENT_RADIUS}px 0 0 ${SEGMENT_RADIUS}px`,
        borderRight: 'none',
    };
}

function transitionOutShape(): CSSProperties {
    return {
        ...transitionShapeBase(HOLD_HEIGHT),
        borderRadius: `0 ${SEGMENT_RADIUS}px ${SEGMENT_RADIUS}px 0`,
        borderLeft: 'none',
    };
}

function holdShape(): CSSProperties {
    return {
        ...holdShapeBase(HOLD_HEIGHT),
        borderRadius: 0,
    };
}

// ============= CONTAINER =============

export const cameraLayoutContainer = {
    base: 'absolute flex items-center [--block-bg:var(--primary)]',
    hoverClass: 'hover:[--block-bg:var(--primary-highlighted)]',
    ...containerCursors,
};

// ============= TRANSITION-IN SEGMENT =============

export const transitionInSegment = {
    base: `absolute flex-shrink-0 ${blockBorder.base} ${blockBorder.highlighted} transition-colors z-[5]`,
    defaultClass: '',
    selectedClass: blockBorder.selected,
    hoverClass: '',
    getStyle: (): CSSProperties => transitionInShape(),
};

// ============= HOLD SEGMENT =============

export const holdSegment = {
    base: `absolute flex-shrink-0 rounded-sm transition-colors z-10 ${blockBorder.base} ${blockBorder.highlighted}`,
    defaultClass: '',
    selectedClass: blockBorder.selected,
    hoverClass: '',
    getStyle: (): CSSProperties => holdShape(),
};

// ============= TRANSITION-OUT SEGMENT =============

export const transitionOutSegment = {
    base: `absolute flex-shrink-0 ${blockBorder.base} ${blockBorder.highlighted} transition-colors z-[5]`,
    defaultClass: '',
    selectedClass: blockBorder.selected,
    hoverClass: '',
    getStyle: (): CSSProperties => transitionOutShape(),
};

// ============= RESIZE HANDLES =============

export const resizeHandle = {
    ...sharedResizeHandle,
    height: DRAG_HANDLE_HEIGHT,
};

export const dragHandleIndicator = {
    ...sharedDragHandleIndicator,
    height: DRAG_HANDLE_HEIGHT,
};

// ============= GHOST =============

export const ghostCameraLayout = {
    container: ghostContainerBase,
    label: ghostLabel,
    transitionIn: {
        className: blockBorder.base,
        getStyle: (): CSSProperties => transitionInShape(),
    },
    hold: {
        className: blockBorder.base,
        getStyle: (): CSSProperties => ({
            ...holdShape(),
            borderRadius: `0`,
        }),
    },
    transitionOut: {
        className: blockBorder.base,
        getStyle: (): CSSProperties => transitionOutShape(),
    },
};
