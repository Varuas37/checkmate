import {
  CORE_THEME_NAMES,
  DARK_THEME,
  DEFAULT_THEME_PREFERENCE,
  DEFAULT_THEME_STORAGE_KEY,
  LIGHT_THEME,
  PREFERS_DARK_MEDIA_QUERY,
  SYSTEM_THEME,
} from "./constants.ts";
import type { ThemeName, ThemePreference } from "./constants.ts";

export interface ThemeConfiguration {
  readonly defaultTheme?: ThemePreference;
  readonly storageKey?: string;
  readonly themes?: readonly ThemeName[];
}

export interface ThemeSnapshot {
  readonly preference: ThemePreference;
  readonly resolvedTheme: ThemeName;
  readonly themes: readonly ThemeName[];
}

function canUseDom(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function fallbackTheme(themes: readonly ThemeName[]): ThemeName {
  return themes[0] ?? DARK_THEME;
}

export function normalizeThemeList(inputThemes?: readonly ThemeName[]): readonly ThemeName[] {
  const baseThemes = inputThemes ?? CORE_THEME_NAMES;
  const uniqueThemes: ThemeName[] = [];

  baseThemes.forEach((theme) => {
    if (theme.length === 0) {
      return;
    }

    if (uniqueThemes.includes(theme)) {
      return;
    }

    uniqueThemes.push(theme);
  });

  if (uniqueThemes.length > 0) {
    return uniqueThemes;
  }

  return [...CORE_THEME_NAMES];
}

export function isThemeName(value: string, themes: readonly ThemeName[]): value is ThemeName {
  return themes.some((theme) => theme === value);
}

export function sanitizeThemePreference(
  preference: ThemePreference,
  themes: readonly ThemeName[],
  fallback: ThemePreference = DEFAULT_THEME_PREFERENCE,
): ThemePreference {
  if (preference === SYSTEM_THEME) {
    return SYSTEM_THEME;
  }

  if (isThemeName(preference, themes)) {
    return preference;
  }

  if (fallback === SYSTEM_THEME) {
    return SYSTEM_THEME;
  }

  if (isThemeName(fallback, themes)) {
    return fallback;
  }

  return fallbackTheme(themes);
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
  themes: readonly ThemeName[],
): ThemeName {
  if (preference !== SYSTEM_THEME && isThemeName(preference, themes)) {
    return preference;
  }

  if (systemPrefersDark) {
    const darkTheme = themes.find((theme) => theme === DARK_THEME);
    if (darkTheme) {
      return darkTheme;
    }
  }

  const lightTheme = themes.find((theme) => theme === LIGHT_THEME);
  if (lightTheme) {
    return lightTheme;
  }

  return fallbackTheme(themes);
}

export function getSystemPrefersDark(): boolean {
  if (!canUseDom() || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia(PREFERS_DARK_MEDIA_QUERY).matches;
}

export function readStoredThemePreference(storageKey: string, themes: readonly ThemeName[]): ThemePreference | null {
  if (!canUseDom()) {
    return null;
  }

  try {
    const storedValue = window.localStorage.getItem(storageKey);
    if (!storedValue) {
      return null;
    }

    if (storedValue === SYSTEM_THEME) {
      return SYSTEM_THEME;
    }

    if (isThemeName(storedValue, themes)) {
      return storedValue;
    }
  } catch {
    return null;
  }

  return null;
}

export function persistThemePreference(storageKey: string, preference: ThemePreference): void {
  if (!canUseDom()) {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, preference);
  } catch {
    // Ignore quota or sandbox failures so theme switching still works in-memory.
  }
}

export function inferColorScheme(theme: ThemeName): "dark" | "light" {
  return theme.toLowerCase().includes("dark") ? "dark" : "light";
}

export function applyThemeToRoot(resolvedTheme: ThemeName, root?: HTMLElement): void {
  if (!canUseDom()) {
    return;
  }

  const targetRoot = root ?? document.documentElement;
  targetRoot.setAttribute("data-theme", resolvedTheme);
  targetRoot.style.colorScheme = inferColorScheme(resolvedTheme);
}

export function getThemeSnapshot(configuration: ThemeConfiguration = {}): ThemeSnapshot {
  const themes = normalizeThemeList(configuration.themes);
  const defaultTheme = sanitizeThemePreference(
    configuration.defaultTheme ?? DEFAULT_THEME_PREFERENCE,
    themes,
    DEFAULT_THEME_PREFERENCE,
  );
  const storageKey = configuration.storageKey ?? DEFAULT_THEME_STORAGE_KEY;
  const storedTheme = readStoredThemePreference(storageKey, themes);
  const preference = storedTheme ?? defaultTheme;
  const resolvedTheme = resolveTheme(preference, getSystemPrefersDark(), themes);

  return {
    preference,
    resolvedTheme,
    themes,
  };
}

export function initializeTheme(configuration: ThemeConfiguration = {}): ThemeSnapshot {
  const snapshot = getThemeSnapshot(configuration);
  applyThemeToRoot(snapshot.resolvedTheme);
  return snapshot;
}

export function subscribeToSystemThemeChanges(onChange: (prefersDark: boolean) => void): () => void {
  if (!canUseDom() || typeof window.matchMedia !== "function") {
    return () => undefined;
  }

  const mediaQuery = window.matchMedia(PREFERS_DARK_MEDIA_QUERY);
  const handleChange = (event: MediaQueryListEvent) => {
    onChange(event.matches);
  };

  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }

  mediaQuery.addListener(handleChange);
  return () => mediaQuery.removeListener(handleChange);
}

export function getNextToggleTheme(currentResolvedTheme: ThemeName, themes: readonly ThemeName[]): ThemeName {
  const darkAvailable = themes.some((theme) => theme === DARK_THEME);
  const lightAvailable = themes.some((theme) => theme === LIGHT_THEME);

  if (darkAvailable && lightAvailable) {
    return currentResolvedTheme === DARK_THEME ? LIGHT_THEME : DARK_THEME;
  }

  const activeIndex = themes.findIndex((theme) => theme === currentResolvedTheme);
  if (activeIndex < 0) {
    return fallbackTheme(themes);
  }

  const nextIndex = (activeIndex + 1) % themes.length;
  return themes[nextIndex] ?? fallbackTheme(themes);
}

export function formatThemeLabel(theme: ThemeName): string {
  const words = theme.split(/[-_ ]+/g).filter((value) => value.length > 0);

  if (words.length === 0) {
    return "Theme";
  }

  return words
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
}
