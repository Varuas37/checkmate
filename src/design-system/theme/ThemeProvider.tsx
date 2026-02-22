import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  DEFAULT_THEME_PREFERENCE,
  DEFAULT_THEME_STORAGE_KEY,
  SYSTEM_THEME,
} from "./constants.ts";
import type { ThemeName, ThemePreference } from "./constants.ts";
import {
  applyThemeToRoot,
  getNextToggleTheme,
  getSystemPrefersDark,
  getThemeSnapshot,
  normalizeThemeList,
  persistThemePreference,
  resolveTheme,
  sanitizeThemePreference,
  subscribeToSystemThemeChanges,
} from "./themeUtils.ts";

export interface ThemeContextValue {
  readonly theme: ThemePreference;
  readonly resolvedTheme: ThemeName;
  readonly themes: readonly ThemeName[];
  readonly setTheme: (theme: ThemePreference) => void;
  readonly toggleTheme: () => void;
}

export interface ThemeProviderProps {
  readonly children: ReactNode;
  readonly defaultTheme?: ThemePreference;
  readonly storageKey?: string;
  readonly themes?: readonly ThemeName[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  defaultTheme = DEFAULT_THEME_PREFERENCE,
  storageKey = DEFAULT_THEME_STORAGE_KEY,
  themes,
}: ThemeProviderProps) {
  const normalizedThemes = useMemo(() => normalizeThemeList(themes), [themes]);
  const [theme, setThemeState] = useState<ThemePreference>(() => {
    return getThemeSnapshot({
      defaultTheme,
      storageKey,
      themes: normalizedThemes,
    }).preference;
  });
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => getSystemPrefersDark());

  useEffect(() => {
    setThemeState((currentTheme) => sanitizeThemePreference(currentTheme, normalizedThemes, defaultTheme));
  }, [defaultTheme, normalizedThemes]);

  useEffect(() => {
    return subscribeToSystemThemeChanges(setSystemPrefersDark);
  }, []);

  const resolvedTheme = useMemo(
    () => resolveTheme(theme, systemPrefersDark, normalizedThemes),
    [normalizedThemes, systemPrefersDark, theme],
  );

  useEffect(() => {
    applyThemeToRoot(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    persistThemePreference(storageKey, theme);
  }, [storageKey, theme]);

  const setTheme = useCallback(
    (nextTheme: ThemePreference) => {
      setThemeState((currentTheme) => sanitizeThemePreference(nextTheme, normalizedThemes, currentTheme));
    },
    [normalizedThemes],
  );

  const toggleTheme = useCallback(() => {
    setThemeState((currentTheme) => {
      const activeTheme = resolveTheme(currentTheme, getSystemPrefersDark(), normalizedThemes);
      return getNextToggleTheme(activeTheme, normalizedThemes);
    });
  }, [normalizedThemes]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      themes: normalizedThemes,
      setTheme,
      toggleTheme,
    }),
    [normalizedThemes, resolvedTheme, setTheme, theme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider.");
  }

  return context;
}

export function useSystemThemePreference(): boolean {
  const { theme, resolvedTheme } = useTheme();

  if (theme === SYSTEM_THEME) {
    return resolvedTheme.toLowerCase().includes("dark");
  }

  return false;
}
