import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "hsl(var(--color-canvas) / <alpha-value>)",
        surface: "hsl(var(--color-surface) / <alpha-value>)",
        elevated: "hsl(var(--color-surface-elevated) / <alpha-value>)",
        border: "hsl(var(--color-border) / <alpha-value>)",
        text: "hsl(var(--color-text) / <alpha-value>)",
        muted: "hsl(var(--color-muted) / <alpha-value>)",
        accent: "hsl(var(--color-accent) / <alpha-value>)",
        "accent-contrast": "hsl(var(--color-accent-contrast) / <alpha-value>)",
        positive: "hsl(var(--color-positive) / <alpha-value>)",
        caution: "hsl(var(--color-caution) / <alpha-value>)",
        danger: "hsl(var(--color-danger) / <alpha-value>)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "sans-serif"],
        body: ["var(--font-body)", "ui-sans-serif", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        soft: "var(--shadow-soft)",
      },
    },
  },
};

export default config;
