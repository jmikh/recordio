// ------------------------------------------------------------------
// VISUAL CONSTANTS
// ------------------------------------------------------------------

/** Size of square corner resize handles (in CSS pixels) */
export const CORNER_HANDLE_SIZE = 10;

/** Width of invisible edge hit areas (in CSS pixels) */
export const EDGE_HIT_AREA_WIDTH = 8;

/** Offset for edge handles to avoid overlapping with corner handles */
export const EDGE_CORNER_OFFSET = 10;

/** Size of circular corner radius handles (in CSS pixels) */
export const RADIUS_HANDLE_SIZE = 10;

/** Border width for the main bounding box */
export const BOX_BORDER_WIDTH = 1.5;

/** Border width for the straight-line overlay */
export const OVERLAY_BORDER_WIDTH = 1;

// ------------------------------------------------------------------
// INTERACTION CONSTANTS
// ------------------------------------------------------------------

/** Minimum inset from corner for radius handles (in output pixels) */
export const RADIUS_HANDLE_MIN_INSET = 12;

// ------------------------------------------------------------------
// COLORS
// ------------------------------------------------------------------

/** Primary color CSS variable reference */
export const PRIMARY_COLOR = 'var(--primary)';

/** Handle border color */
export const HANDLE_BORDER_COLOR = 'white';

// ------------------------------------------------------------------
// Z-INDEX LAYERS
// ------------------------------------------------------------------

/** Z-index for edge handles (below corner handles) */
export const Z_INDEX_EDGE_HANDLE = 5;

/** Z-index for corner handles */
export const Z_INDEX_CORNER_HANDLE = 10;

/** Z-index for the main bounding box */
export const Z_INDEX_BOUNDING_BOX = 100;

/** Z-index for corner radius handles and floating controls */
export const Z_INDEX_RADIUS_HANDLE = 110;
