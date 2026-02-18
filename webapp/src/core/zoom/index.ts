// Zoom Module
// Handles focus area detection, zoom action calculation, and zoom scheduling

export { getAllFocusAreas, type FocusArea } from './focusManager';
export {
    calculateZoomSchedule,
    ViewMapper
} from './autoZoom';
export {
    getViewportStateAtTime,
    prepareZoomSegmentsForInterpolation,
    type PreparedZoomSegment
} from './zoomAnimator';
