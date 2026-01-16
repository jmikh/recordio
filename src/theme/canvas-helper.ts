/**
 * Theme Helper for Canvas & Logic
 * 
 * Allows JavaScript/Canvas to access the same CSS Variables defined in index.css
 * ensuring the rendering logic matches the DOM theme.
 */

// Cache formatted color values could be added here if performance is an issue,
// but for now we read fresh to allow live theme-switching.

export const getThemeToken = (variableName: string): string => {
    // Note: variableName should start with '--' e.g. '--bg-surface'
    const val = getComputedStyle(document.body).getPropertyValue(variableName).trim();
    return val;
};

export const theme = {
    colors: {
        bg: {
            app: () => getThemeToken('--bg-app'),
            surface: () => getThemeToken('--bg-surface'),
        },
        border: {
            base: () => getThemeToken('--border-base'),
            primary: () => getThemeToken('--border-primary'),
        },
        text: {
            highlighted: () => getThemeToken('--text-highlighted'),
            main: () => getThemeToken('--text-main'),
            muted: () => getThemeToken('--text-muted'),
        },
        accent: {
            primary: () => getThemeToken('--primary'),
        }
    },
    // Add more as needed
};
