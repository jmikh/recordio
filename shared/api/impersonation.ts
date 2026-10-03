/**
 * What an impersonation token is allowed to do: LOOK, and nothing else.
 *
 * Admin impersonation (plans/admin-user-impersonation-oneshot.md) mints a
 * token that is a full session for the target user, so every route used
 * to accept it — which meant an admin browsing someone's account could
 * save an edit onto their project by doing nothing more than opening the
 * editor (the 2s auto-save). This list is the fix: an impersonation token
 * is accepted ONLY on the routes named here.
 *
 * The list is the single source of truth for both sides:
 * - the server enforces it in `requireUser` (plugins/auth.ts) — the
 *   guarantee, since a token holder can call the API directly;
 * - the webapp checks it in `invokeFunction` so a blocked call fails
 *   instantly with a clear message instead of a round-trip 403.
 *
 * FAIL CLOSED: anything absent is blocked, so a new route is read-only
 * for impersonation until someone deliberately adds it here. Adding a
 * route means asserting it does not mutate the target's account —
 * incidental writes count too (`last_accessed_at` bumps and the like are
 * skipped inside those routes via `isImpersonating`).
 *
 * `project-clone` is the one write on the list, and it writes only to the
 * ADMIN's own account — copying the target's project out is the whole
 * point of the feature.
 */
export const IMPERSONATION_ALLOWED_ROUTES: ReadonlySet<string> = new Set([
    // Projects — read + the editor's media
    'project-get',
    'project-list',
    'storage-download-urls',
    'render-job-get-status',
    'asset-list',
    // Screenshots
    'screenshot-get',
    'screenshot-list',
    // Public/share reads
    'shared-video-get',
    'shared-screenshot-get',
    // Account/session bootstrap
    'workspace-get',
    'workspace-list',
    'workspace-get-default',
    'user-profile-get',
    'user-project-defaults-get',
    'subscription-get',
    // The sanctioned write: copies INTO the admin's own workspace
    'project-clone',
]);

/** True when an impersonation token may call this route (see above). */
export function isAllowedWhileImpersonating(routeName: string): boolean {
    return IMPERSONATION_ALLOWED_ROUTES.has(routeName);
}

/**
 * The /admin-* routes are the ADMIN's own, never the target's: the webapp
 * sends them with the admin's real session token even mid-impersonation,
 * so the /admin page keeps working (its gate probe would otherwise be
 * refused as a write on the impersonation token) and the admin can hop
 * to another user or project without exiting first. The server side is
 * unchanged — an impersonation token is still refused on these routes,
 * since they are absent from the allowlist above.
 */
export function isAdminRoute(routeName: string): boolean {
    return routeName.startsWith('admin-');
}

/** Shown by both sides when a write is refused — one wording, one meaning. */
export const IMPERSONATION_READ_ONLY_MESSAGE =
    'Read-only while impersonating — this action would change the user\'s account';
