/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--bg-app)",
        surface: {
          DEFAULT: "var(--bg-surface)",
          elevated: "var(--bg-surface-elevated)",
        },
        border: {
          DEFAULT: "var(--border-base)",
          highlight: "var(--border-highlight)",
          primary: "var(--border-primary)",
        },
        text: {
          main: "var(--text-main)",
          muted: "var(--text-muted)",
          inverted: "var(--text-inverted)",
        },
      },
      primary: {
        DEFAULT: "var(--primary)",
        fg: "var(--primary-fg)",
      },
      secondary: {
        DEFAULT: "var(--secondary)",
        fg: "var(--secondary-fg)",
      },
      tertiary: {
        DEFAULT: "var(--tertiary)",
        fg: "var(--tertiary-fg)",
      },
      destructive: "var(--destructive)",
    },
    borderRadius: {
      sm: "var(--radius-sm)",
      md: "var(--radius-md)",
      lg: "var(--radius-lg)",
    },
    spacing: {
      header: "var(--header-height)",
      track: "var(--track-height)",
    },
    fontFamily: {
      sans: ["var(--font-sans)"],
    }
  },
},
plugins: [],
}
