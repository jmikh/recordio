/**
 * Element Group Detection Utilities
 * 
 * Finds the outermost "group" element (card, modal, container) matching visual criteria:
 * - Visual signal (any ONE): box-shadow OR drop-shadow OR border OR modal backdrop OR opaque background
 * - Border radius: must have non-zero border-radius (own, inherited from same-size parent, or shadow DOM)
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
export function findElementGroup(element: Element, minSize: number = 150, debug: boolean = false): ElementGroupResult | null {
    let current: Element | null = element;
    let farthestMatch: Element | null = null;
    let farthestMatchRadius: [number, number, number, number] = [0, 0, 0, 0];
    let farthestMatchSignals: string[] = [];

    // Track bubbled radius from same-size children
    let bubbledRadius: [number, number, number, number] = [0, 0, 0, 0];
    let lastRect: DOMRect | null = null;
    let prevHadVisualSignal = false;

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

        // Save previous rect before update (for overflow check below)
        const prevRect = lastRect;
        lastRect = rect;

        // Overflow boundary: if previous child extends beyond current parent,
        // the child is visually independent (e.g., dropdown overflowing container).
        // Only stop when: child had visual signals AND parent doesn't clip overflow.
        // Transparent layout wrappers (noVisual) can safely overflow without breaking.
        // Skip overflow check for display:contents elements — they have no box,
        // so children trivially "overflow" the 0x0 rect, but it's not a real boundary.
        const isContentsDisplay = style.display === 'contents';
        if (!isSameSize && prevRect && prevHadVisualSignal && !isContentsDisplay) {
            const OVERFLOW_TOLERANCE = 5; // px
            const childOverflows =
                prevRect.right > rect.right + OVERFLOW_TOLERANCE ||
                prevRect.bottom > rect.bottom + OVERFLOW_TOLERANCE ||
                prevRect.left < rect.left - OVERFLOW_TOLERANCE ||
                prevRect.top < rect.top - OVERFLOW_TOLERANCE;
            if (childOverflows) {
                // Don't stop if current element clips its children
                const clipsOverflow = ['hidden', 'auto', 'scroll', 'clip'].some(
                    v => style.overflowX === v || style.overflowY === v
                );
                if (!clipsOverflow) {
                    if (debug) {
                        const tag = current.tagName.toLowerCase();
                        const cls = typeof (current as HTMLElement).className === 'string' ? (current as HTMLElement).className.split(' ')[0] : '';
                        console.log(`[HoveredCard]   ⏹ <${tag}${cls ? '.' + cls : ''}> ${Math.round(rect.width)}x${Math.round(rect.height)} — child overflows parent, stopping`, current);
                    }
                    break;
                }
            }
        }

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

        // Additional visual signals
        const hasBackgroundImage = style.backgroundImage && style.backgroundImage !== 'none';

        let hasVisualSignal = hasBoxShadow || hasDropShadow || hasBorder || hasModalBackdrop || hasOpaqueBackground || hasBackgroundImage;

        // Shadow DOM visual signal peek: web components often style internally
        // around <slot>, so the host has no visual signals from getComputedStyle.
        // Peek into shadow root's direct children for visual signals.
        if (!hasVisualSignal && current.shadowRoot) {
            for (const shadowChild of current.shadowRoot.children) {
                if (!(shadowChild instanceof HTMLElement)) continue;
                const sStyle = window.getComputedStyle(shadowChild);
                const sBg = sStyle.backgroundColor;
                const sTransparent = sBg === 'transparent' || sBg === 'rgba(0, 0, 0, 0)';
                const sRgba = sBg.match(/rgba\([^)]+,\s*([\d.]+)\)/);
                if ((sStyle.boxShadow && sStyle.boxShadow !== 'none') ||
                    (sStyle.filter && sStyle.filter.includes('drop-shadow')) ||
                    (sStyle.borderWidth && parseFloat(sStyle.borderWidth) > 0 && sStyle.borderStyle !== 'none') ||
                    (!sTransparent && (!sRgba || parseFloat(sRgba[1]) > 0))) {
                    hasVisualSignal = true;
                    break;
                }
            }
        }

        // Slotted content visual signal check: when an element is projected into
        // a shadow DOM <slot>, the visual wrapper (bg/shadow/radius) is inside the
        // shadow DOM around the slot — invisible to normal parentElement traversal.
        if (!hasVisualSignal && current instanceof HTMLElement && current.assignedSlot) {
            let slotParent: Element | null = current.assignedSlot.parentElement;
            while (slotParent) {
                if (slotParent instanceof HTMLElement) {
                    const spStyle = window.getComputedStyle(slotParent);
                    const spBg = spStyle.backgroundColor;
                    const spTransparent = spBg === 'transparent' || spBg === 'rgba(0, 0, 0, 0)';
                    const spRgba = spBg.match(/rgba\([^)]+,\s*([\d.]+)\)/);
                    if ((spStyle.boxShadow && spStyle.boxShadow !== 'none') ||
                        (spStyle.filter && spStyle.filter.includes('drop-shadow')) ||
                        (spStyle.borderWidth && parseFloat(spStyle.borderWidth) > 0 && spStyle.borderStyle !== 'none') ||
                        (!spTransparent && (!spRgba || parseFloat(spRgba[1]) > 0))) {
                        hasVisualSignal = true;
                        break;
                    }
                }
                // Stop at shadow root boundary
                if (slotParent.parentElement) {
                    slotParent = slotParent.parentElement;
                } else {
                    break;
                }
            }
        }

        // Must be fully visible in viewport — partially offscreen cards aren't valid
        const isVisibleInViewport = rect.left >= 0 && rect.top >= 0 &&
            rect.right <= viewportWidth && rect.bottom <= viewportHeight;

        // Skip non-interactive wrappers (e.g., transparent modal containers)
        const isInteractive = style.pointerEvents !== 'none';

        // Collect matched visual signals for debug
        const visualSignals: string[] = [];
        if (hasBoxShadow) visualSignals.push('shadow');
        if (hasDropShadow) visualSignals.push('dropShadow');
        if (hasBorder) visualSignals.push('border');
        if (hasModalBackdrop) visualSignals.push('backdrop');
        if (hasOpaqueBackground) visualSignals.push('opaqueBg');
        if (hasBackgroundImage) visualSignals.push('bgImage');


        if (debug) {
            const tag = current.tagName.toLowerCase();
            const cls = typeof (current as HTMLElement).className === 'string' ? (current as HTMLElement).className.split(' ')[0] : '';
            const id = `<${tag}${cls ? '.' + cls : ''}>`;
            const dims = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
            const reasons: string[] = [];
            if (!meetsMinSize) reasons.push('tooSmall');
            if (!meetsMaxSize) reasons.push('tooLarge');
            if (!hasVisualSignal) reasons.push('noVisual');
            if (!isVisibleInViewport) reasons.push('offscreen');
            if (!isInteractive) reasons.push('noPointer');
            const pass = meetsMinSize && meetsMaxSize && hasVisualSignal && isVisibleInViewport && isInteractive;

            // Visual signals for passing elements
            if (pass && visualSignals.length) reasons.push(visualSignals.join(', '));

            // Radius diagnostics
            const radiusInfo: string[] = [];
            if (currentRadius.some(r => r > 0)) radiusInfo.push(`border-radius=[${currentRadius.join(',')}]`);
            if (style.clipPath && style.clipPath !== 'none') radiusInfo.push(`clip-path="${style.clipPath}"`);
            if (style.maskImage && style.maskImage !== 'none') radiusInfo.push(`mask-image="${style.maskImage}"`);
            if (style.webkitMaskImage && style.webkitMaskImage !== 'none') radiusInfo.push(`-webkit-mask-image`);
            if (style.overflow !== 'visible' && style.overflow !== '') radiusInfo.push(`overflow=${style.overflow}`);
            // Check shadow DOM children for radius
            if (current.shadowRoot) {
                for (const sc of current.shadowRoot.children) {
                    if (sc instanceof HTMLElement) {
                        const scRadius = getCornerRadius(sc);
                        if (scRadius.some(r => r > 0)) {
                            radiusInfo.push(`shadow-child-radius=[${scRadius.join(',')}]`);
                            break;
                        }
                    }
                }
            }
            const radiusStr = radiusInfo.length ? ` | ${radiusInfo.join(', ')}` : '';
            console.log(`[HoveredCard]   ${pass ? '✅' : '❌'} ${id} ${dims}${reasons.length ? ' — ' + reasons.join(', ') : ''}${radiusStr}`, current);
        }

        if (meetsMinSize && meetsMaxSize && hasVisualSignal && isVisibleInViewport && isInteractive) {
            farthestMatch = current;
            farthestMatchRadius = bubbledRadius;
            farthestMatchSignals = visualSignals;
        }

        // Track visual signal for overflow boundary check on next iteration
        prevHadVisualSignal = !!hasVisualSignal;

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

    // Radius inheritance: if matched element has no radius, check same-sized
    // parents for border-radius (handles non-interactive visual wrappers like
    // elements with pointer-events:none that provide shadow/radius styling)
    if (farthestMatch && farthestMatchRadius.every(r => r === 0)) {
        const matchRect = farthestMatch.getBoundingClientRect();
        let ancestor = farthestMatch.parentElement;
        while (ancestor && ancestor !== document.body) {
            const ancestorRect = ancestor.getBoundingClientRect();
            const sameSize = Math.abs(ancestorRect.width - matchRect.width) < 2 &&
                Math.abs(ancestorRect.height - matchRect.height) < 2;
            if (!sameSize) break; // Size changed, stop looking
            const radius = getCornerRadius(ancestor);
            if (radius.some(r => r > 0)) {
                farthestMatchRadius = radius;
                break;
            }
            ancestor = ancestor.parentElement;
        }
    }

    // Shadow DOM radius inheritance: web components often apply border-radius
    // on internal wrappers around <slot>, invisible from the host element.
    if (farthestMatch && farthestMatchRadius.every(r => r === 0) && farthestMatch.shadowRoot) {
        for (const shadowChild of farthestMatch.shadowRoot.children) {
            if (shadowChild instanceof HTMLElement) {
                const radius = getCornerRadius(shadowChild);
                if (radius.some(r => r > 0)) {
                    farthestMatchRadius = radius;
                    break;
                }
            }
        }
    }

    // Slotted content radius inheritance: when the matched element is projected
    // into a shadow DOM <slot>, check the slot's parent wrapper for radius.
    if (farthestMatch && farthestMatchRadius.every(r => r === 0) &&
        farthestMatch instanceof HTMLElement && farthestMatch.assignedSlot) {
        let slotParent: Element | null = farthestMatch.assignedSlot.parentElement;
        while (slotParent) {
            if (slotParent instanceof HTMLElement) {
                const radius = getCornerRadius(slotParent);
                if (radius.some(r => r > 0)) {
                    farthestMatchRadius = radius;
                    break;
                }
            }
            if (slotParent.parentElement) {
                slotParent = slotParent.parentElement;
            } else {
                break;
            }
        }
    }

    // Require border-radius: cards/modals must have rounded corners
    if (farthestMatch && farthestMatchRadius.every(r => r === 0)) {
        if (debug) {
            const tag = farthestMatch.tagName.toLowerCase();
            const cls = typeof (farthestMatch as HTMLElement).className === 'string' ? (farthestMatch as HTMLElement).className.split(' ')[0] : '';
            console.log(`[HoveredCard]   ⏹ <${tag}${cls ? '.' + cls : ''}> — rejected: no border-radius`);
        }
        farthestMatch = null;
    }

    if (debug) {
        if (farthestMatch) {
            const tag = farthestMatch.tagName.toLowerCase();
            const cls = typeof (farthestMatch as HTMLElement).className === 'string' ? (farthestMatch as HTMLElement).className.split(' ')[0] : '';
            const signalsStr = farthestMatchSignals.length ? ` matched=[${farthestMatchSignals.join(', ')}]` : '';
            console.log(`[HoveredCard]   → Result: <${tag}${cls ? '.' + cls : ''}> radius=[${farthestMatchRadius.join(',')}]${signalsStr}`);
        } else {
            console.log(`[HoveredCard]   → No match`);
        }
    }

    return farthestMatch ? { element: farthestMatch, effectiveRadius: farthestMatchRadius } : null;
}
