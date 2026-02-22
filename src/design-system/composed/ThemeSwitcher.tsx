import type { HTMLAttributes } from "react";

import { cn } from "../../shared/index.ts";
import { SYSTEM_THEME, formatThemeLabel, useTheme } from "../theme/index.ts";
import type { ThemePreference } from "../theme/index.ts";

export interface ThemeSwitcherProps extends HTMLAttributes<HTMLDivElement> {
  readonly includeSystemOption?: boolean;
}

type ThemeSwitchChoice = ThemePreference;

export function ThemeSwitcher({ className, includeSystemOption = true, ...props }: ThemeSwitcherProps) {
  const { setTheme, theme, themes } = useTheme();
  const choices: ThemeSwitchChoice[] = [...themes];

  if (includeSystemOption && !choices.includes(SYSTEM_THEME)) {
    choices.push(SYSTEM_THEME);
  }

  return (
    <div
      role="group"
      aria-label="Theme selection"
      className={cn("inline-flex items-center rounded-md border border-border bg-canvas p-1 shadow-inset", className)}
      {...props}
    >
      {choices.map((choice) => {
        const isActive = theme === choice;
        const label = choice === SYSTEM_THEME ? "System" : formatThemeLabel(choice);

        return (
          <button
            key={choice}
            type="button"
            onClick={() => setTheme(choice)}
            aria-pressed={isActive}
            className={cn(
              "rounded-sm border border-transparent px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors",
              isActive
                ? "border-border-strong bg-surface text-text"
                : "text-muted hover:border-border hover:bg-surface hover:text-text",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
