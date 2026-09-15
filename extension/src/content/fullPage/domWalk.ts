/**
 * @fileoverview Composed-tree walk: light DOM plus every OPEN shadow root
 * (Reddit alone has ~1 700), skipping our own injected nodes. Budgeted by
 * node count and wall time because it runs once per tile.
 */

export interface WalkOptions {
    maxNodes?: number;
    maxMs?: number;
}

export interface WalkResult {
    visited: number;
    budgetHit: boolean;
}

const DEFAULT_MAX_NODES = 40000;
const DEFAULT_MAX_MS = 250;

export function isRecordioNode(el: Element): boolean {
    if (el.hasAttribute('data-recordio')) return true;
    if (el.id.startsWith('recordio-')) return true;
    const cls = el.getAttribute('class');
    return !!cls && cls.startsWith('recordio-');
}

function pushChildren(stack: Element[], node: Element | ShadowRoot): void {
    if ('shadowRoot' in node && node.shadowRoot) {
        for (let i = node.shadowRoot.children.length - 1; i >= 0; i--) stack.push(node.shadowRoot.children[i]);
    }
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
}

/**
 * Depth-first over `root`'s descendants (not `root` itself). `visit` returns
 * `false` to skip an element's subtree.
 */
export function walkComposed(
    root: Element | ShadowRoot,
    visit: (el: Element) => boolean | void,
    options: WalkOptions = {},
): WalkResult {
    const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
    const maxMs = options.maxMs ?? DEFAULT_MAX_MS;
    const start = performance.now();
    const stack: Element[] = [];
    pushChildren(stack, root);

    let visited = 0;
    let budgetHit = false;
    while (stack.length) {
        const el = stack.pop()!;
        visited++;
        if (visited > maxNodes || ((visited & 255) === 0 && performance.now() - start > maxMs)) {
            budgetHit = true;
            break;
        }
        if (isRecordioNode(el)) continue;
        if (visit(el) === false) continue;
        pushChildren(stack, el);
    }
    return { visited, budgetHit };
}
