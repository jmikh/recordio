/**
 * Element Group Detection Utilities
 * 
 * Finds the outermost "group" element (card, modal, container) matching visual criteria:
 * - Visual signal (any ONE): box-shadow OR drop-shadow OR border OR modal backdrop OR opaque background
 * - Size: configurable min, 80% viewport max
 * - Must be fully visible in viewport
 */

export interface ElementGroupResult {
    element: Element;
    effectiveRadius: [number, number, number, number]; // [tl, tr, br, bl]
}

/**
 * Get raw border radius values from an element as [tl, tr, br, bl].
 * Also checks clip-path: inset(... round X) as a fallback.
 */
function getCornerRadius(element: Element): [number, number, number, number] {
    const style = window.getComputedStyle(element);

    let tl = parseFloat(style.borderTopLeftRadius) || 0;
    let tr = parseFloat(style.borderTopRightRadius) || 0;
    let br = parseFloat(style.borderBottomRightRadius) || 0;
    let bl = parseFloat(style.borderBottomLeftRadius) || 0;

    // If no border-radius, check clip-path for inset(...round X) pattern
    if (tl === 0 && tr === 0 && br === 0 && bl === 0) {
        const clipPath = style.clipPath;
        if (clipPath && clipPath.includes('round')) {
            const roundMatch = clipPath.match(/round\s+([\d.]+)(?:px)?\s*([\d.]+)?(?:px)?\s*([\d.]+)?(?:px)?\s*([\d.]+)?(?:px)?/);
            if (roundMatch) {
                const r1 = parseFloat(roundMatch[1]) || 0;
                const r2 = roundMatch[2] ? parseFloat(roundMatch[2]) : r1;
                const r3 = roundMatch[3] ? parseFloat(roundMatch[3]) : r1;
                const r4 = roundMatch[4] ? parseFloat(roundMatch[4]) : r2;
                tl = r1; tr = r2; br = r3; bl = r4;
            }
        }
    }

    return [tl, tr, br, bl];
}

/**
 * Convert corner radius array to CSS border-radius string with padding
 */
export function cornerRadiusToString(radius: [number, number, number, number], padding: number): string {
    return `${radius[0] + padding}px ${radius[1] + padding}px ${radius[2] + padding}px ${radius[3] + padding}px`;
}

/**
 * Check if an element is a modal backdrop (full viewport + semi-transparent bg)
 */
function isBackdrop(el: Element, viewportWidth: number, viewportHeight: number): boolean {
    const elRect = el.getBoundingClientRect();
    const isFullViewport = elRect.width >= viewportWidth * 0.9 && elRect.height >= viewportHeight * 0.9;
    if (!isFullViewport) return false;

    const elStyle = window.getComputedStyle(el);
    const bgColor = elStyle.backgroundColor;
    const rgbaMatch = bgColor.match(/rgba?\([\d\s,]+,\s*([\d.]+)\)/);
    return !!(rgbaMatch && parseFloat(rgbaMatch[1]) > 0 && parseFloat(rgbaMatch[1]) < 1);
}

/**
 * Find the outermost element group (card/modal/container) matching detection criteria.
 * 
 * @param element - The starting element to search from
 * @param minSize - Minimum width/height in pixels (default: 200)
 * @returns The matching element with its effective corner radius, or null if none found
 */
export function findElementGroup(element: Element, minSize: number = 200): ElementGroupResult | null {
    let current: Element | null = element;
    let farthestMatch: Element | null = null;
    let farthestMatchRadius: [number, number, number, number] = [0, 0, 0, 0];

    // Track bubbled radius from same-size children
    let bubbledRadius: [number, number, number, number] = [0, 0, 0, 0];
    let lastRect: DOMRect | null = null;

    // Cache viewport dimensions
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    while (current && current !== document.body && current !== document.documentElement) {
        const style = window.getComputedStyle(current);
        const rect = current.getBoundingClientRect();

        // Get this element's corner radius
        const currentRadius = getCornerRadius(current);

        // Check if same size as previous (child) - bubble up larger radius
        const isSameSize = lastRect &&
            Math.abs(rect.width - lastRect.width) < 2 &&
            Math.abs(rect.height - lastRect.height) < 2;

        if (isSameSize) {
            bubbledRadius = [
                Math.max(currentRadius[0], bubbledRadius[0]),
                Math.max(currentRadius[1], bubbledRadius[1]),
                Math.max(currentRadius[2], bubbledRadius[2]),
                Math.max(currentRadius[3], bubbledRadius[3])
            ];
        } else {
            bubbledRadius = currentRadius;
        }

        lastRect = rect;

        // Size constraints
        const meetsMinSize = rect.width >= minSize && rect.height >= minSize;
        const meetsMaxSize = rect.width <= viewportWidth * 0.8 && rect.height <= viewportHeight * 0.8;

        // Visual signals
        const hasBoxShadow = style.boxShadow && style.boxShadow !== 'none';
        const hasDropShadow = style.filter && style.filter.includes('drop-shadow');
        const hasBorder = style.borderWidth && parseFloat(style.borderWidth) > 0 && style.borderStyle !== 'none';

        // Check for modal backdrop (parent or sibling)
        let hasModalBackdrop = false;
        const parent = current.parentElement;

        if (parent && parent !== document.body) {
            if (isBackdrop(parent, viewportWidth, viewportHeight)) {
                hasModalBackdrop = true;
            } else {
                let sibling = current.previousElementSibling;
                while (sibling) {
                    if (isBackdrop(sibling, viewportWidth, viewportHeight)) {
                        hasModalBackdrop = true;
                        break;
                    }
                    sibling = sibling.previousElementSibling;
                }
            }
        }

        // Check for opaque background
        const bgColor = style.backgroundColor;
        const isTransparent = bgColor === 'transparent' || bgColor === 'rgba(0, 0, 0, 0)';
        const rgbaAlphaMatch = bgColor.match(/rgba\([^)]+,\s*([\d.]+)\)/);
        const hasOpaqueBackground = !isTransparent && (!rgbaAlphaMatch || parseFloat(rgbaAlphaMatch[1]) > 0);

        const hasVisualSignal = hasBoxShadow || hasDropShadow || hasBorder || hasModalBackdrop || hasOpaqueBackground;

        // Check if fully visible in viewport
        const isFullyInViewport = rect.left >= 0 && rect.top >= 0 &&
            rect.right <= viewportWidth && rect.bottom <= viewportHeight;

        if (meetsMinSize && meetsMaxSize && hasVisualSignal && isFullyInViewport) {
            farthestMatch = current;
            farthestMatchRadius = bubbledRadius;
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

    return farthestMatch ? { element: farthestMatch, effectiveRadius: farthestMatchRadius } : null;
}
