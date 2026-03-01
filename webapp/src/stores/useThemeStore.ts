import { create } from 'zustand';

export type Theme = 'light' | 'dark';

const THEME_KEY = 'recordio-theme';
const LEGACY_KEY = 'recordio-user-storage';

/** Read the persisted theme, migrating from the legacy user store if needed. */
function getInitialTheme(): Theme {
    // 1. Check the dedicated theme key first
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;

    // 2. Migrate from legacy user store (theme was inside a JSON blob)
    try {
        const legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy) {
            const parsed = JSON.parse(legacy);
            const legacyTheme = parsed?.state?.theme;
            if (legacyTheme === 'light' || legacyTheme === 'dark') {
                localStorage.setItem(THEME_KEY, legacyTheme);
                return legacyTheme;
            }
        }
    } catch {
        // Corrupt or missing — fall through to default
    }

    // 3. Default to light
    localStorage.setItem(THEME_KEY, 'light');
    return 'light';
}

interface ThemeState {
    theme: Theme;
    setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeState>()((set) => ({
    theme: getInitialTheme(),

    setTheme: (theme) => {
        // Update DOM
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }

        // Persist to dedicated key
        localStorage.setItem(THEME_KEY, theme);

        set({ theme });
    },
}));
