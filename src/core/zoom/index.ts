// Zoom Module
// Handles focus area detection, viewport motion calculation, and zoom scheduling

export { getAllFocusAreas, type FocusArea } from './focusManager';
export {
    calculateZoomSchedule,
    getViewportStateAtTime,
    ViewMapper
} from './viewportMotion';
