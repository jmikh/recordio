import { create } from 'zustand';
import { LocalPreferences } from '../lib/localPreferences';

export type Theme = 'light' | 'dark';

/** Read the persisted theme, migrating from the legacy user store if needed. */
function getInitialTheme(): Theme {
    // 1. Check the dedicated theme key first
    const stored = LocalPreferences.getTheme();
    if (stored) return stored;

    // 2. Migrate from legacy user store (theme was inside a JSON blob)
    const legacyTheme = LocalPreferences.getLegacyTheme();
    if (legacyTheme) {
        LocalPreferences.setTheme(legacyTheme);
        return legacyTheme;
    }

    // 3. Default to light
    LocalPreferences.setTheme('light');
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
        LocalPreferences.setTheme(theme);

        set({ theme });
    },
}));
