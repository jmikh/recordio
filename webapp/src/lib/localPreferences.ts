/**
 * Central gateway for all localStorage access in the webapp.
 *
 * Every persisted preference key lives here so there's a single place
 * to see (and search for) all local state the app writes to disk.
 *
 * NOTE: The inline <script> in webapp/index.html also reads 'recordio-theme'
 * directly — that's intentional (it runs before any JS bundle loads to
 * prevent a white flash).
 */

const THEME_KEY = 'recordio-theme';
const LEGACY_THEME_KEY = 'recordio-user-storage';
const SW_DECODE_KEY = 'recordio:prefer-software-decode';

export class LocalPreferences {
    // ── Theme ────────────────────────────────────────────────────

    static getTheme(): 'light' | 'dark' | null {
        const v = localStorage.getItem(THEME_KEY);
        if (v === 'light' || v === 'dark') return v;
        return null;
    }

    static setTheme(theme: 'light' | 'dark'): void {
        localStorage.setItem(THEME_KEY, theme);
    }

    /** Read-only — migrates theme from the legacy JSON blob if present. */
    static getLegacyTheme(): 'light' | 'dark' | null {
        try {
            const raw = localStorage.getItem(LEGACY_THEME_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                const t = parsed?.state?.theme;
                if (t === 'light' || t === 'dark') return t;
            }
        } catch {
            // Corrupt or missing
        }
        return null;
    }

    // ── Video decode preference ──────────────────────────────────

    static getPreferSoftwareDecode(): boolean {
        return localStorage.getItem(SW_DECODE_KEY) === 'true';
    }

    static setPreferSoftwareDecode(value: boolean): void {
        localStorage.setItem(SW_DECODE_KEY, value ? 'true' : 'false');
    }
}
