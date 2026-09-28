/** The sections of the hidden admin surface and their paths (App routes on these). */
export type AdminSection = 'users' | 'growth';

export const ADMIN_SECTION_PATHS: Record<AdminSection, string> = {
    users: '/admin',
    growth: '/admin/growth',
};

/** The section an /admin path names; unknown sub-paths fall back to Users. */
export function adminSectionFromPath(path: string): AdminSection {
    return path === ADMIN_SECTION_PATHS.growth ? 'growth' : 'users';
}
