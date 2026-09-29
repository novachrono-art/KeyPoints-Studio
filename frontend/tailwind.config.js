/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class", // Use class-based dark mode, NOT system preference
  theme: {
    extend: {
      colors: {
        // Linear & Stripe Inspired Palette with Light Blue & White Canvas
        brand: {
          50: "#EEF2FF",
          100: "#E0E7FF",
          200: "#C7D2FE",
          300: "#A5B4FC",
          400: "#818CF8",
          500: "#6366F1",
          600: "#4F46E5",
          700: "#4338CA",
          800: "#3730A3",
          900: "#312E81",
        },
        surface: "#F8FAFC",
        paper: "#F8FAFC",
        "paper-deep": "#F1F5F9",
        card: "#FFFFFF",
        ink: "#0F172A",
        muted: "#475569",
        faint: "#94A3B8",
        line: "#E2E8F0",
        pine: {
          DEFAULT: "#4F46E5",
          dark: "#4338CA",
          tint: "rgba(79, 70, 229, 0.08)",
        },
        accent: {
          DEFAULT: "#4F46E5",
          soft: "rgba(79, 70, 229, 0.08)",
          dark: "#4338CA",
          glow: "rgba(79, 70, 229, 0.22)",
        },
        amber: {
          DEFAULT: "#D97706",
          soft: "rgba(217, 119, 6, 0.10)",
        },
        brick: {
          DEFAULT: "#DC2626",
          soft: "rgba(220, 38, 38, 0.10)",
        },
        danger: "#DC2626",
        success: "#10B981",
      },
      fontFamily: {
        display: ["'Plus Jakarta Sans'", "Inter", "-apple-system", "sans-serif"],
        body: ["Inter", "'Plus Jakarta Sans'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 20px -2px rgba(79, 70, 229, 0.25)",
        "glow-lg": "0 0 35px -5px rgba(79, 70, 229, 0.35)",
        dock: "0 20px 40px -10px rgba(15, 23, 42, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.8)",
      },
    },
  },
  plugins: [],
};
