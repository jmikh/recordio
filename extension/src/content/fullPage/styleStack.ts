/**
 * @fileoverview Inline-style changes with undo, for the full-page session.
 *
 * Every change goes through `set` so `restoreAll` can put the page back
 * exactly (value + priority), and `reassert` can re-apply anything a
 * framework re-render wiped between tiles. All values are applied with
 * `!important` so page stylesheets can't win.
 */

interface Entry {
    el: Element & ElementCSSInlineStyle;
    prop: string;
    prev: string;
    prevPriority: string;
    value: string;
}

export class StyleStack {
    private entries: Entry[] = [];
    private index = new Map<Element, Map<string, Entry>>();

    set(el: Element & ElementCSSInlineStyle, prop: string, value: string): void {
        let byProp = this.index.get(el);
        if (!byProp) {
            byProp = new Map();
            this.index.set(el, byProp);
        }
        let entry = byProp.get(prop);
        if (!entry) {
            entry = { el, prop, prev: el.style.getPropertyValue(prop), prevPriority: el.style.getPropertyPriority(prop), value };
            byProp.set(prop, entry);
            this.entries.push(entry);
        } else {
            entry.value = value;
        }
        el.style.setProperty(prop, value, 'important');
    }

    /** Re-applies every tracked value (frameworks that own `style` may have rewritten it). */
    reassert(): void {
        for (const e of this.entries) {
            if (e.el.style.getPropertyValue(e.prop) !== e.value || e.el.style.getPropertyPriority(e.prop) !== 'important') {
                e.el.style.setProperty(e.prop, e.value, 'important');
            }
        }
    }

    restoreAll(): void {
        for (let i = this.entries.length - 1; i >= 0; i--) {
            const e = this.entries[i];
            if (e.prev === '') e.el.style.removeProperty(e.prop);
            else e.el.style.setProperty(e.prop, e.prev, e.prevPriority);
        }
        this.entries = [];
        this.index.clear();
    }

    get size(): number {
        return this.entries.length;
    }
}
