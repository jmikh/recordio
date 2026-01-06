import equal from 'fast-deep-equal';

/**
 * Checks if `subset` is contained within `full`.
 * 
 * - If `subset` has a key, `full` must have it with a matching value.
 * - If the value is an object, it recurses.
 * - If the value is an array or primitive, it checks strict equality (using fast-deep-equal for arrays/objects).
 */
export function isSubset(full: any, subset: any): boolean {
    if (subset === full) return true;
    if (subset === undefined || subset === null) return true; // Treating undefined/null as "nothing to check"? No, if subset is explicitly something, it matters. 
    // But if subset is just "empty updates", then yes.

    if (typeof subset !== 'object' || typeof full !== 'object' || full === null) {
        // Primitive mismatch (since we passed strict check above)
        // Or one is object and other is not
        // Use deep equal for safe measure on leaf nodes that might be arrays calling into this?
        // Actually, if we are strictly comparing values at leaf:
        return equal(full, subset);
    }

    // Iterate over keys in subset
    for (const key of Object.keys(subset)) {
        const subValue = subset[key];
        const fullValue = full[key];

        if (subValue === undefined) continue; // Skip undefined updates usually? Or does explicit undefined mean delete? 
        // In DeepPartial, usually undefined means "no update".

        if (!isSubset(fullValue, subValue)) {
            return false;
        }
    }

    return true;
}
