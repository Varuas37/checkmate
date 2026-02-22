import { useEffect, useMemo, useState } from "react";

import { Button, Input, Modal, ThemeSwitcher } from "../../../design-system/index.ts";
import { cn } from "../../../shared/index.ts";
import type {
  AgentTrackingInitializationResult,
  CliAgentConfig,
  CliAgentsSettings,
  CmCliInstallResult,
  CmCliStatus,
  RecentProjectEntry,
} from "../../../shared/index.ts";

export interface SettingsPanelProps {
  readonly open: boolean;
  readonly initialApiKey: string;
  readonly initialMaxChurn: number;
  readonly initialProjectStandardsPath: string;
  readonly initialCliAgents: CliAgentsSettings;
  readonly activeRepositoryPath: string;
  readonly recentProjects: readonly RecentProjectEntry[];
  readonly cmCliStatus: CmCliStatus | null;
  readonly onOpenProjectInCurrentWindow: () => void | Promise<void>;
  readonly onOpenProjectInNewWindow: () => void | Promise<void>;
  readonly onOpenRecentProjectInCurrentWindow: (repositoryPath: string) => void | Promise<void>;
  readonly onOpenRecentProjectInNewWindow: (repositoryPath: string) => void | Promise<void>;
  readonly onInitializeTracking: (
    repositoryPath: string,
  ) => Promise<AgentTrackingInitializationResult>;
  readonly onInstallCmCli: () => Promise<CmCliInstallResult>;
  readonly onRefreshCmCliStatus: () => Promise<void>;
  readonly onSave: (apiKey: string) => void;
  readonly onSaveMaxChurn: (maxChurn: number) => void;
  readonly onSaveProjectStandardsPath: (standardsPath: string) => void;
  readonly onSaveCliAgents: (settings: CliAgentsSettings) => void;
  readonly onClose: () => void;
}

type SettingsSectionId = "projects" | "appearance" | "analysis" | "integrations" | "cli-agents";

interface SettingsSection {
  readonly id: SettingsSectionId;
  readonly label: string;
  readonly detail: string;
}

const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: "projects",
    label: "Projects",
    detail: "Repositories and cm command",
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
  {
    id: "cli-agents",
    label: "CLI Agents",
    detail: "Command-line AI tools",
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

interface AgentEditDraft {
  readonly name: string;
  readonly command: string;
  readonly promptArgs: string;
}

export function SettingsPanel({
  open,
  initialApiKey,
  initialMaxChurn,
  initialProjectStandardsPath,
  initialCliAgents,
  activeRepositoryPath,
  recentProjects,
  cmCliStatus,
  onOpenProjectInCurrentWindow,
  onOpenProjectInNewWindow,
  onOpenRecentProjectInCurrentWindow,
  onOpenRecentProjectInNewWindow,
  onInitializeTracking,
  onInstallCmCli,
  onRefreshCmCliStatus,
  onSave,
  onSaveMaxChurn,
  onSaveProjectStandardsPath,
  onSaveCliAgents,
  onClose,
}: SettingsPanelProps) {
  const [draft, setDraft] = useState(initialApiKey);
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const [isApiKeyEditing, setIsApiKeyEditing] = useState(false);
  const [churnDraft, setChurnDraft] = useState(String(initialMaxChurn));
  const [projectStandardsPathDraft, setProjectStandardsPathDraft] = useState(initialProjectStandardsPath);
  const [isProjectActionRunning, setIsProjectActionRunning] = useState(false);
  const [projectActionError, setProjectActionError] = useState<string | null>(null);
  const [cmCliActionError, setCmCliActionError] = useState<string | null>(null);
  const [cmCliActionMessage, setCmCliActionMessage] = useState<string | null>(null);
  const [isCmCliActionRunning, setIsCmCliActionRunning] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("projects");
  const [draftCliAgents, setDraftCliAgents] = useState<CliAgentsSettings>(initialCliAgents);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [agentEditDraft, setAgentEditDraft] = useState<AgentEditDraft | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setDraft(initialApiKey);
    setIsApiKeyVisible(false);
    setIsApiKeyEditing(false);
    setChurnDraft(String(initialMaxChurn));
    setProjectStandardsPathDraft(initialProjectStandardsPath);
    setIsProjectActionRunning(false);
    setProjectActionError(null);
    setCmCliActionError(null);
    setCmCliActionMessage(null);
    setIsCmCliActionRunning(false);
    setDraftCliAgents(initialCliAgents);
    setEditingAgentId(null);
    setAgentEditDraft(null);
    setActiveSection("projects");
    // Only re-initialise when the modal opens, not on every prop change while open.
    // Local state is authoritative while open; changes propagate up via callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const getErrorMessage = (error: unknown): string => {
    if (!error) {
      return "Action failed.";
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

  const runCmCliAction = async (action: () => Promise<void>) => {
    if (isCmCliActionRunning) {
      return;
    }

    setCmCliActionError(null);
    setCmCliActionMessage(null);
    setIsCmCliActionRunning(true);
    try {
      await action();
    } catch (error) {
      setCmCliActionError(getErrorMessage(error));
    } finally {
      setIsCmCliActionRunning(false);
    }
  };

  const saveApiKeyDraft = () => {
    const normalized = draft.trim();
    onSave(normalized);
    setDraft(normalized);
    setIsApiKeyEditing(false);
  };

  const setActiveCliAgent = (agentId: string) => {
    const next: CliAgentsSettings = { ...draftCliAgents, activeAgentId: agentId };
    setDraftCliAgents(next);
    onSaveCliAgents(next);
  };

  const togglePreferCli = () => {
    const next: CliAgentsSettings = {
      ...draftCliAgents,
      preferCliOverApi: !draftCliAgents.preferCliOverApi,
    };
    setDraftCliAgents(next);
    onSaveCliAgents(next);
  };

  const startEditingAgent = (agent: CliAgentConfig) => {
    setEditingAgentId(agent.id);
    setAgentEditDraft({
      name: agent.name,
      command: agent.command,
      promptArgs: agent.promptArgs.join(" "),
    });
  };

  const saveAgentEdit = () => {
    if (!editingAgentId || !agentEditDraft) {
      return;
    }

    const updatedAgents = draftCliAgents.agents.map((agent) =>
      agent.id === editingAgentId
        ? {
            ...agent,
            name: agentEditDraft.name.trim() || agent.name,
            command: agentEditDraft.command.trim() || agent.command,
            promptArgs: agentEditDraft.promptArgs
              .trim()
              .split(/\s+/)
              .filter((arg) => arg.length > 0),
          }
        : agent,
    );

    const next: CliAgentsSettings = { ...draftCliAgents, agents: updatedAgents };
    setDraftCliAgents(next);
    onSaveCliAgents(next);
    setEditingAgentId(null);
    setAgentEditDraft(null);
  };

  const currentBackendLabel = useMemo(() => {
    const hasApiKey = draft.trim().length > 0;
    const activeAgent = draftCliAgents.activeAgentId
      ? draftCliAgents.agents.find((a) => a.id === draftCliAgents.activeAgentId)
      : null;

    if (draftCliAgents.preferCliOverApi && activeAgent) {
      return `${activeAgent.name} CLI (preferred over API)`;
    }

    if (hasApiKey) {
      if (activeAgent) {
        return `Anthropic SDK API (${activeAgent.name} as fallback)`;
      }
      return "Anthropic SDK API";
    }

    if (activeAgent) {
      return `${activeAgent.name} CLI (no API key set)`;
    }

    return "Claude CLI hardcoded fallback (no API key, no agent configured)";
  }, [draft, draftCliAgents]);

  const hasActiveRepositoryPath = activeRepositoryPath.trim().length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Settings"
      panelClassName="w-[min(96vw,72rem)] max-w-none"
    >
      <div className="grid min-h-[34rem] gap-0 md:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="border-b border-border/60 pb-2 md:border-b-0 md:border-r md:pb-0 md:pr-4">
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

        <div className="min-h-0 space-y-4 pt-2 md:max-h-[36rem] md:overflow-y-auto md:pl-5 md:pt-0">
          {projectActionError && (
            <p className="rounded-sm border border-danger/45 bg-danger/10 px-2 py-1.5 text-xs text-danger">
              {projectActionError}
            </p>
          )}
          {cmCliActionError && (
            <p className="rounded-sm border border-danger/45 bg-danger/10 px-2 py-1.5 text-xs text-danger">
              {cmCliActionError}
            </p>
          )}
          {cmCliActionMessage && (
            <p className="rounded-sm border border-accent/40 bg-accent/10 px-2 py-1.5 text-xs text-accent">
              {cmCliActionMessage}
            </p>
          )}

          {activeSection === "projects" && (
            <section className="space-y-3">
              <header>
                <h3 className="text-base font-semibold text-text">Projects</h3>
                <p className="text-sm text-muted">Open repositories and configure the `cm` shell command.</p>
              </header>

              <div className="space-y-2 border-y border-border/60 py-3">
                <p className="text-[11px] uppercase tracking-[0.1em] text-muted">Current Project</p>
                <p className="break-all font-mono text-xs text-text">
                  {activeRepositoryPath.trim().length > 0 ? activeRepositoryPath : "No project loaded"}
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
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
              </div>

              <div className="space-y-1.5 border-b border-border/60 pb-3">
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

              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-[0.1em] text-muted">Shell Command</p>
                <p className="text-sm text-muted">
                  Install a global <code className="font-mono text-xs">cm</code> command.
                </p>
                <p className="break-all font-mono text-xs text-text">
                  {cmCliStatus?.installed && cmCliStatus.installPath
                    ? cmCliStatus.onPath
                      ? `Installed: ${cmCliStatus.installPath}`
                      : `Installed (not on PATH): ${cmCliStatus.installPath}`
                    : "Not installed"}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isCmCliActionRunning}
                    onClick={() => {
                      void runCmCliAction(async () => {
                        const result = await onInstallCmCli();
                        setCmCliActionMessage(result.message);
                      });
                    }}
                  >
                    {cmCliStatus?.installed ? "Reinstall cm in PATH" : "Install cm in PATH"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isCmCliActionRunning}
                    onClick={() => {
                      void runCmCliAction(async () => {
                        await onRefreshCmCliStatus();
                      });
                    }}
                  >
                    Refresh Status
                  </Button>
                </div>
                <p className="text-xs text-muted">
                  Usage: <code className="font-mono">cm .</code> opens HEAD,{" "}
                  <code className="font-mono">cm . --draft</code> opens uncommitted draft changes.
                </p>
              </div>

              <div className="space-y-2 border-t border-border/60 pt-3">
                <p className="text-[11px] uppercase tracking-[0.1em] text-muted">Tracking Files</p>
                <p className="text-sm text-muted">
                  Initialize repository tracking files with <code className="font-mono text-xs">cm init</code>{" "}
                  behavior.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isCmCliActionRunning || !hasActiveRepositoryPath}
                    onClick={() => {
                      void runCmCliAction(async () => {
                        const result = await onInitializeTracking(activeRepositoryPath);
                        setCmCliActionMessage(result.message);
                      });
                    }}
                  >
                    Initialize Tracking
                  </Button>
                </div>
                <p className="text-xs text-muted">
                  Ensures <code className="font-mono">AGENT.md</code> exists, and{" "}
                  <code className="font-mono">CLAUDE.md</code> includes{" "}
                  <code className="font-mono">@AGENT.md</code>, and writes{" "}
                  <code className="font-mono">.checkmate/commit_context.schema.json</code>.
                </p>
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
                <p className="text-sm text-muted">
                  Control file-analysis limits and project standards configuration.
                </p>
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
              <div className="space-y-2 border-b border-border/60 pb-3">
                <label className="block text-xs text-text-subtle">
                  Coding standards file path (current project)
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    value={projectStandardsPathDraft}
                    onChange={(event) => {
                      setProjectStandardsPathDraft(event.target.value);
                    }}
                    placeholder="coding_standards.md"
                    aria-label="Coding standards file path"
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const normalized = projectStandardsPathDraft.trim();
                      onSaveProjectStandardsPath(normalized);
                      setProjectStandardsPathDraft(normalized);
                    }}
                  >
                    Save
                  </Button>
                </div>
                <p className="text-xs text-muted">
                  If empty, Checkmate first tries{" "}
                  <code className="rounded bg-surface-subtle/70 px-1 py-0.5 font-mono text-[11px]">
                    coding_standards.md
                  </code>{" "}
                  in the repo root, then falls back to the built-in project standards baseline.
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
                  <div className="flex items-center gap-2">
                    <Input
                      autoFocus
                      value={draft}
                      onChange={(event) => {
                        setDraft(event.target.value);
                      }}
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
                    <Button variant="secondary" size="sm" onClick={saveApiKeyDraft}>
                      Save
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDraft(initialApiKey);
                        setIsApiKeyEditing(false);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (draft.trim().length === 0) {
                          return;
                        }
                        setIsApiKeyVisible((current) => !current);
                      }}
                      className={cn(
                        "flex h-9 min-w-0 flex-1 items-center rounded-md border border-border bg-canvas px-3 text-left font-mono text-xs text-text transition-colors",
                        "hover:border-border-strong",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas",
                      )}
                      aria-label={isApiKeyVisible ? "Hide API key" : "Show API key"}
                      title={draft.trim().length > 0 ? "Click to toggle visibility" : "No API key set"}
                    >
                      <span className="truncate">
                        {isApiKeyVisible ? draft.trim() || "No API key set" : maskApiKey(draft)}
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 shrink-0 px-0"
                      onClick={() => {
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
                      className="h-9 w-9 shrink-0 px-0 text-danger hover:text-danger"
                      onClick={() => {
                        setDraft("");
                        setIsApiKeyVisible(false);
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
                )}
                <p className="text-xs text-muted">
                  Stored in localStorage. Click the key to toggle visibility.
                </p>
              </div>
            </section>
          )}

          {activeSection === "cli-agents" && (
            <section className="space-y-4">
              <header>
                <h3 className="text-base font-semibold text-text">CLI Agents</h3>
                <p className="text-sm text-muted">
                  Configure command-line AI tools for analysis and review.
                </p>
              </header>

              <div className="border-y border-border/60 py-2.5">
                <p className="pb-1 text-[11px] uppercase tracking-[0.08em] text-muted">
                  Current backend
                </p>
                <p className="font-mono text-xs text-text">{currentBackendLabel}</p>
              </div>

              <div className="space-y-1">
                <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Available agents</p>
                {draftCliAgents.agents.map((agent) => {
                  const isActive = agent.id === draftCliAgents.activeAgentId;
                  const isEditing = agent.id === editingAgentId;

                  return (
                    <div
                      key={agent.id}
                      className="rounded-sm border border-border/60 bg-surface-subtle/30 px-2.5 py-2"
                    >
                      {isEditing && agentEditDraft ? (
                        <div className="space-y-2">
                          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
                            <label className="text-xs text-muted">Name</label>
                            <Input
                              value={agentEditDraft.name}
                              onChange={(event) => {
                                setAgentEditDraft({ ...agentEditDraft, name: event.target.value });
                              }}
                              className="h-7 font-mono text-xs"
                              placeholder="e.g. Claude Code"
                            />
                            <label className="text-xs text-muted">Command</label>
                            <Input
                              value={agentEditDraft.command}
                              onChange={(event) => {
                                setAgentEditDraft({ ...agentEditDraft, command: event.target.value });
                              }}
                              className="h-7 font-mono text-xs"
                              placeholder="e.g. claude"
                            />
                            <label className="text-xs text-muted">Args</label>
                            <Input
                              value={agentEditDraft.promptArgs}
                              onChange={(event) => {
                                setAgentEditDraft({
                                  ...agentEditDraft,
                                  promptArgs: event.target.value,
                                });
                              }}
                              className="h-7 font-mono text-xs"
                              placeholder="-p  (space-separated, placed before the prompt)"
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button variant="secondary" size="sm" onClick={saveAgentEdit}>
                              Save
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditingAgentId(null);
                                setAgentEditDraft(null);
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium text-text">{agent.name}</span>
                              {isActive && (
                                <span className="rounded-sm border border-accent/40 bg-accent/12 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-accent">
                                  active
                                </span>
                              )}
                            </div>
                            <p className="truncate font-mono text-xs text-muted">
                              {agent.command}
                              {agent.promptArgs.length > 0
                                ? ` ${agent.promptArgs.join(" ")}`
                                : ""}
                              {" <prompt>"}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                            {!isActive && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 font-mono text-[11px] uppercase tracking-[0.06em]"
                                onClick={() => {
                                  setActiveCliAgent(agent.id);
                                }}
                              >
                                Set active
                              </Button>
                            )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 font-mono text-[11px] uppercase tracking-[0.06em]"
                                onClick={() => {
                                  startEditingAgent(agent);
                                }}
                              >
                                Edit
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-border/60 pt-3">
                <p className="pb-2 text-[11px] uppercase tracking-[0.08em] text-muted">Preferences</p>
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={draftCliAgents.preferCliOverApi}
                    onChange={togglePreferCli}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                  />
                  <div>
                    <p className="text-sm font-medium text-text">Prefer CLI over Anthropic API</p>
                    <p className="mt-0.5 text-xs text-muted">
                      When enabled, the active CLI agent is tried first before the API key.
                      Falls back to the API if the CLI fails.
                    </p>
                  </div>
                </label>
              </div>
            </section>
          )}
        </div>
      </div>
    </Modal>
  );
}
