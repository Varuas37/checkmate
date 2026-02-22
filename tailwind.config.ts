import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "hsl(var(--color-canvas) / <alpha-value>)",
        surface: "hsl(var(--color-surface) / <alpha-value>)",
        elevated: "hsl(var(--color-surface-elevated) / <alpha-value>)",
        "surface-subtle": "hsl(var(--color-surface-subtle) / <alpha-value>)",
        border: "hsl(var(--color-border) / <alpha-value>)",
        "border-strong": "hsl(var(--color-border-strong) / <alpha-value>)",
        "border-muted": "hsl(var(--color-border-muted) / <alpha-value>)",
        text: "hsl(var(--color-text) / <alpha-value>)",
        muted: "hsl(var(--color-muted) / <alpha-value>)",
        "text-subtle": "hsl(var(--color-text-subtle) / <alpha-value>)",
        accent: "hsl(var(--color-accent) / <alpha-value>)",
        "accent-emphasis": "hsl(var(--color-accent-emphasis) / <alpha-value>)",
        "accent-contrast": "hsl(var(--color-accent-contrast) / <alpha-value>)",
        positive: "hsl(var(--color-positive) / <alpha-value>)",
        "positive-emphasis": "hsl(var(--color-positive-emphasis) / <alpha-value>)",
        caution: "hsl(var(--color-caution) / <alpha-value>)",
        "caution-emphasis": "hsl(var(--color-caution-emphasis) / <alpha-value>)",
        danger: "hsl(var(--color-danger) / <alpha-value>)",
        "danger-emphasis": "hsl(var(--color-danger-emphasis) / <alpha-value>)",
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
        inset: "var(--shadow-inset)",
      },
    },
  },
};

export default config;
