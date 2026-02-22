import { useEffect, useState } from "react";

import { Button, Input, Modal, ThemeSwitcher } from "../../../design-system/index.ts";
import { cn } from "../../../shared/index.ts";
import type { RecentProjectEntry } from "../../../shared/index.ts";

export interface SettingsPanelProps {
  readonly open: boolean;
  readonly initialApiKey: string;
  readonly initialMaxChurn: number;
  readonly activeRepositoryPath: string;
  readonly recentProjects: readonly RecentProjectEntry[];
  readonly onOpenProjectInCurrentWindow: () => void | Promise<void>;
  readonly onOpenProjectInNewWindow: () => void | Promise<void>;
  readonly onOpenRecentProjectInCurrentWindow: (repositoryPath: string) => void | Promise<void>;
  readonly onOpenRecentProjectInNewWindow: (repositoryPath: string) => void | Promise<void>;
  readonly onSave: (apiKey: string) => void;
  readonly onSaveMaxChurn: (maxChurn: number) => void;
  readonly onClose: () => void;
}

type SettingsSectionId = "projects" | "appearance" | "analysis" | "integrations";

interface SettingsSection {
  readonly id: SettingsSectionId;
  readonly label: string;
  readonly detail: string;
}

const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: "projects",
    label: "Projects",
    detail: "Open and switch repositories",
  },
  {
    id: "appearance",
    label: "Appearance",
    detail: "Theme preferences",
  },
  {
    id: "analysis",
    label: "AI Analysis",
    detail: "Generation limits",
  },
  {
    id: "integrations",
    label: "Integrations",
    detail: "API credentials",
  },
];

function maskApiKey(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return "No API key set";
  }

  if (normalized.length <= 10) {
    return normalized;
  }

  const prefix = normalized.slice(0, 6);
  const suffix = normalized.slice(-4);
  const hiddenLength = Math.max(8, normalized.length - prefix.length - suffix.length);
  return `${prefix}${"*".repeat(hiddenLength)}${suffix}`;
}

export function SettingsPanel({
  open,
  initialApiKey,
  initialMaxChurn,
  activeRepositoryPath,
  recentProjects,
  onOpenProjectInCurrentWindow,
  onOpenProjectInNewWindow,
  onOpenRecentProjectInCurrentWindow,
  onOpenRecentProjectInNewWindow,
  onSave,
  onSaveMaxChurn,
  onClose,
}: SettingsPanelProps) {
  const [draft, setDraft] = useState(initialApiKey);
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const [isApiKeyEditing, setIsApiKeyEditing] = useState(false);
  const [churnDraft, setChurnDraft] = useState(String(initialMaxChurn));
  const [isProjectActionRunning, setIsProjectActionRunning] = useState(false);
  const [projectActionError, setProjectActionError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("projects");

  useEffect(() => {
    if (!open) {
      return;
    }

    setDraft(initialApiKey);
    setIsApiKeyVisible(false);
    setIsApiKeyEditing(false);
    setChurnDraft(String(initialMaxChurn));
    setProjectActionError(null);
    setActiveSection("projects");
  }, [initialApiKey, initialMaxChurn, open]);

  const getErrorMessage = (error: unknown): string => {
    if (!error) {
      return "Failed to open project.";
    }

    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  };

  const runProjectAction = async (action: () => void | Promise<void>) => {
    if (isProjectActionRunning) {
      return;
    }

    setProjectActionError(null);
    setIsProjectActionRunning(true);
    try {
      await action();
    } catch (error) {
      setProjectActionError(getErrorMessage(error));
    } finally {
      setIsProjectActionRunning(false);
    }
  };

  const saveApiKeyDraft = () => {
    const normalized = draft.trim();
    onSave(normalized);
    setDraft(normalized);
    setIsApiKeyEditing(false);
  };

  return (
    <Modal open={open} onClose={onClose} title="Settings" panelClassName="max-w-5xl">
      <div className="grid min-h-[32rem] gap-0 md:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="border-b border-border/60 pb-2 md:border-b-0 md:border-r md:pb-0 md:pr-3">
          <p className="px-1 pb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">Preferences</p>
          <nav className="space-y-1">
            {SETTINGS_SECTIONS.map((section) => {
              const isActive = section.id === activeSection;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    "w-full rounded-sm border border-transparent px-2 py-2 text-left transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas",
                    isActive ? "border-border bg-surface-subtle/55" : "hover:bg-surface-subtle/35",
                  )}
                >
                  <p className={cn("text-sm font-medium", isActive ? "text-text" : "text-muted")}>{section.label}</p>
                  <p className="mt-0.5 text-xs text-muted">{section.detail}</p>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="min-h-0 space-y-4 pt-2 md:max-h-[34rem] md:overflow-y-auto md:pl-4 md:pt-0">
          {projectActionError && (
            <p className="rounded-sm border border-danger/45 bg-danger/10 px-2 py-1.5 text-xs text-danger">
              {projectActionError}
            </p>
          )}

          {activeSection === "projects" && (
            <section className="space-y-3">
              <header>
                <h3 className="text-base font-semibold text-text">Projects</h3>
                <p className="text-sm text-muted">Open a project in this window or in a new review window.</p>
              </header>

              <div className="border-y border-border/60 py-2">
                <p className="text-[11px] uppercase tracking-[0.1em] text-muted">Current Project</p>
                <p className="truncate pt-1 font-mono text-xs text-text">
                  {activeRepositoryPath.length > 0 ? activeRepositoryPath : "No project loaded"}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={isProjectActionRunning}
                  onClick={() => {
                    void runProjectAction(onOpenProjectInCurrentWindow);
                  }}
                >
                  Open Project
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={isProjectActionRunning}
                  onClick={() => {
                    void runProjectAction(onOpenProjectInNewWindow);
                  }}
                >
                  Open New Project
                </Button>
              </div>

              <div className="space-y-1.5">
                <p className="text-[11px] uppercase tracking-[0.1em] text-muted">Recent Projects</p>
                {recentProjects.length === 0 && (
                  <p className="rounded-sm border border-dashed border-border/70 px-2 py-2 text-sm text-muted">
                    No recent projects.
                  </p>
                )}
                {recentProjects.slice(0, 10).map((entry, index) => (
                  <div
                    key={`${entry.repositoryPath}-${index}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border/40 py-1.5 last:border-b-0"
                  >
                    <button
                      type="button"
                      className={cn(
                        "min-w-0 truncate text-left font-mono text-xs text-text",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas",
                      )}
                      onClick={() => {
                        void runProjectAction(() => onOpenRecentProjectInCurrentWindow(entry.repositoryPath));
                      }}
                      title={entry.repositoryPath}
                      disabled={isProjectActionRunning}
                    >
                      {entry.repositoryPath}
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isProjectActionRunning}
                      className="h-7 px-2 font-mono text-[11px] uppercase tracking-[0.08em]"
                      onClick={() => {
                        void runProjectAction(() => onOpenRecentProjectInNewWindow(entry.repositoryPath));
                      }}
                    >
                      New Window
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {activeSection === "appearance" && (
            <section className="space-y-3">
              <header>
                <h3 className="text-base font-semibold text-text">Appearance</h3>
                <p className="text-sm text-muted">Set the theme used across all review windows.</p>
              </header>
              <div className="border-y border-border/60 py-3">
                <p className="pb-2 text-[11px] uppercase tracking-[0.1em] text-muted">Theme</p>
                <ThemeSwitcher />
                <p className="pt-2 text-xs text-muted">Theme preference is stored locally.</p>
              </div>
            </section>
          )}

          {activeSection === "analysis" && (
            <section className="space-y-3">
              <header>
                <h3 className="text-base font-semibold text-text">AI Analysis</h3>
                <p className="text-sm text-muted">Control which files are sent for summary generation.</p>
              </header>
              <div className="space-y-2 border-y border-border/60 py-3">
                <label className="block text-xs text-text-subtle">
                  Max file churn threshold (lines changed)
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    step="50"
                    value={churnDraft}
                    onChange={(event) => {
                      setChurnDraft(event.target.value);
                    }}
                    aria-label="Max file churn threshold"
                    className="w-36 font-mono text-xs"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const parsed = parseInt(churnDraft, 10);
                      onSaveMaxChurn(isNaN(parsed) || parsed < 0 ? 0 : parsed);
                    }}
                  >
                    Apply
                  </Button>
                </div>
                <p className="text-xs text-muted">
                  Files where additions + deletions exceed this number are skipped by the AI analyser and
                  receive a placeholder summary. Set to <strong>0</strong> to disable the limit.
                </p>
              </div>
            </section>
          )}

          {activeSection === "integrations" && (
            <section className="space-y-3">
              <header>
                <h3 className="text-base font-semibold text-text">Integrations</h3>
                <p className="text-sm text-muted">Manage provider credentials used for AI requests.</p>
              </header>
              <div className="space-y-2 border-y border-border/60 py-3">
                <label className="block text-[11px] uppercase tracking-[0.08em] text-muted">
                  Anthropic API Key
                </label>
                {isApiKeyEditing ? (
                  <Input
                    autoFocus
                    value={draft}
                    onChange={(event) => {
                      setDraft(event.target.value);
                    }}
                    onBlur={saveApiKeyDraft}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        saveApiKeyDraft();
                        return;
                      }

                      if (event.key === "Escape") {
                        setDraft(initialApiKey);
                        setIsApiKeyEditing(false);
                      }
                    }}
                    placeholder="sk-ant-..."
                    aria-label="Anthropic API key"
                    className="font-mono text-xs"
                  />
                ) : (
                  <div className="group relative">
                    <button
                      type="button"
                      onClick={() => {
                        if (draft.trim().length === 0) {
                          return;
                        }
                        setIsApiKeyVisible((current) => !current);
                      }}
                      className={cn(
                        "flex h-11 w-full items-center rounded-md border border-border bg-canvas px-3 pr-20 text-left font-mono text-xs text-text transition-colors",
                        "hover:border-border-strong",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas",
                      )}
                      aria-label={isApiKeyVisible ? "Hide API key" : "Show API key"}
                      title={draft.trim().length > 0 ? "Click to toggle key visibility" : "No API key set"}
                    >
                      <span className="truncate">
                        {isApiKeyVisible ? draft.trim() || "No API key set" : maskApiKey(draft)}
                      </span>
                    </button>

                    <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="pointer-events-auto h-7 w-7 px-0"
                        onClick={(event) => {
                          event.stopPropagation();
                          setIsApiKeyEditing(true);
                          setIsApiKeyVisible(false);
                        }}
                        aria-label="Edit API key"
                        title="Edit API key"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                        </svg>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="pointer-events-auto h-7 w-7 px-0 text-danger hover:text-danger"
                        onClick={(event) => {
                          event.stopPropagation();
                          setDraft("");
                          setIsApiKeyVisible(false);
                          setIsApiKeyEditing(false);
                          onSave("");
                        }}
                        aria-label="Delete API key"
                        title="Delete API key"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M3 6h18" />
                          <path d="M8 6V4h8v2" />
                          <path d="M19 6l-1 14H6L5 6" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                        </svg>
                      </Button>
                    </div>
                  </div>
                )}
                <p className="text-xs text-muted">
                  Stored in localStorage. Click the key to toggle visibility. Hover the field for edit or delete.
                </p>
              </div>
            </section>
          )}
        </div>
      </div>
    </Modal>
  );
}
