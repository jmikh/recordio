/**
 * SPA navigation utility.
 * Uses history.pushState + a custom DOM event so App.tsx re-renders
 * without a full page reload.
 */
export function navigate(path: string, options?: { replace?: boolean }): void {
    if (options?.replace) {
        window.history.replaceState({}, '', path);
    } else {
        window.history.pushState({}, '', path);
    }
    window.dispatchEvent(new CustomEvent('navigate'));
}
