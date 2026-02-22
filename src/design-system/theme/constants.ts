export const CORE_THEME_NAMES = ["dark", "light"] as const;

export type CoreThemeName = (typeof CORE_THEME_NAMES)[number];
export type ThemeName = CoreThemeName | (string & {});
export type ThemePreference = ThemeName | "system";

export const DARK_THEME: CoreThemeName = "dark";
export const LIGHT_THEME: CoreThemeName = "light";
export const SYSTEM_THEME = "system" as const;

export const DEFAULT_THEME_STORAGE_KEY = "codelens-theme-preference";
export const DEFAULT_THEME_PREFERENCE: ThemePreference = SYSTEM_THEME;
export const PREFERS_DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";
