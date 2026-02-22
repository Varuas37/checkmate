import projectSettingsJson from "../../project_settings.json";

interface ProjectSettings {
  readonly app_name?: string;
}

const FALLBACK_APP_NAME = "checkmate.sh";

function resolveAppName(rawValue: unknown): string {
  if (typeof rawValue !== "string") {
    return FALLBACK_APP_NAME;
  }

  const normalized = rawValue.trim();
  return normalized.length > 0 ? normalized : FALLBACK_APP_NAME;
}

const projectSettings = projectSettingsJson as ProjectSettings;

export const APP_NAME = resolveAppName(projectSettings.app_name);
