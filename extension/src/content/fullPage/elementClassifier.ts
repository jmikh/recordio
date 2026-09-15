/**
 * @fileoverview What to do with a positioned element during a full-page capture.
 *
 * sticky      → relative for the session (appears once, at its natural spot)
 * fixed       → classifyFixedRect decides header / bottom bar / other / skip;
 *               a fixed element under a transformed or contained ancestor
 *               already scrolls with the page and is skipped.
 */

import { classifyFixedRect, type FixedClass } from '../../shared/fullPagePlan';

export type ElementClass = 'sticky' | FixedClass | 'none';

/** Parent in the composed tree (crosses shadow boundaries via the host). */
export function composedParent(el: Element): Element | null {
    if (el.parentElement) return el.parentElement;
    const root = el.getRootNode() as { host?: Element };
    return root.host ?? null;
}

/** An ancestor that establishes a containing block for fixed descendants. */
export function hasFixedContainingBlockAncestor(el: Element): boolean {
    let node = composedParent(el);
    while (node && node !== document.documentElement) {
        const cs = getComputedStyle(node);
        if (
            cs.transform !== 'none'
            || cs.filter !== 'none'
            || cs.perspective !== 'none'
            || /transform|perspective|filter/.test(cs.willChange)
            || /paint|layout|strict|content/.test(cs.contain)
        ) {
            return true;
        }
        node = composedParent(node);
    }
    return false;
}

export function classifyElement(el: Element, style: CSSStyleDeclaration, vw: number, vh: number): ElementClass {
    const position = style.position;
    if (position === 'sticky') return 'sticky';
    if (position !== 'fixed') return 'none';
    if (hasFixedContainingBlockAncestor(el)) return 'skip';
    const r = el.getBoundingClientRect();
    return classifyFixedRect({ x: r.left, y: r.top, width: r.width, height: r.height }, vw, vh);
}
