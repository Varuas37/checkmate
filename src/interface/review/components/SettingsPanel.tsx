import { useEffect, useMemo, useState } from "react";

import { Button, Input, Modal, ThemeSwitcher } from "../../../design-system/index.ts";
import { cn, readClipboardTextFromDesktop } from "../../../shared/index.ts";
import type {
  AgentTrackingInitializationResult,
  AgentTrackingRemovalResult,
  AgentTrackingStatus,
  AiProviderPreference,
  CliAgentConfig,
  CliAgentsSettings,
  CmCliInstallResult,
  CmCliStatus,
  LocalAgentTransport,
} from "../../../shared/index.ts";

export interface SettingsPanelProps {
  readonly open: boolean;
  readonly initialApiKey: string;
  readonly initialMaxChurn: number;
  readonly initialAutoRunOnCommitChange: boolean;
  readonly initialProjectStandardsPath: string;
  readonly initialCliAgents: CliAgentsSettings;
  readonly activeRepositoryPath: string;
  readonly cmCliStatus: CmCliStatus | null;
  readonly onInitializeTracking: (
    repositoryPath: string,
  ) => Promise<AgentTrackingInitializationResult>;
  readonly onReadTrackingStatus: (repositoryPath: string) => Promise<AgentTrackingStatus>;
  readonly onRemoveTracking: (repositoryPath: string) => Promise<AgentTrackingRemovalResult>;
  readonly onInstallCmCli: () => Promise<CmCliInstallResult>;
  readonly onRefreshCmCliStatus: () => Promise<void>;
  readonly onSave: (apiKey: string) => void;
  readonly onTestApiConnection: (apiKey: string) => Promise<string>;
  readonly onSaveMaxChurn: (maxChurn: number) => void;
  readonly onSaveAutoRunOnCommitChange: (enabled: boolean) => void;
  readonly onSaveProjectStandardsPath: (standardsPath: string) => void;
  readonly onSaveCliAgents: (settings: CliAgentsSettings) => void;
  readonly onTestCliConnection: (
    agent: CliAgentConfig,
    transport: LocalAgentTransport,
    repositoryPath?: string,
  ) => Promise<string>;
  readonly onClose: () => void;
}

type SettingsSectionId = "projects" | "appearance" | "providers" | "analysis";

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
    id: "providers",
    label: "AI Providers",
    detail: "API and local agents",
  },
  {
    id: "analysis",
    label: "AI Analysis",
    detail: "Limits and standards",
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
  readonly acpCommand: string;
  readonly acpArgs: string;
  readonly command: string;
  readonly promptArgs: string;
}

type ConnectionStatus = "idle" | "testing" | "connected" | "failed";

function connectionStatusLabel(status: ConnectionStatus): string {
  if (status === "connected") {
    return "Connected";
  }

  if (status === "failed") {
    return "Connection failed";
  }

  if (status === "testing") {
    return "Testing";
  }

  return "Not tested";
}

function connectionStatusDotClass(status: ConnectionStatus): string {
  if (status === "connected") {
    return "bg-emerald-500";
  }

  if (status === "failed") {
    return "bg-danger";
  }

  if (status === "testing") {
    return "animate-pulse bg-accent";
  }

  return "bg-muted";
}

function toConnectionSummary(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 120) {
    return normalized;
  }

  return `${normalized.slice(0, 117)}...`;
}

export function SettingsPanel({
  open,
  initialApiKey,
  initialMaxChurn,
  initialAutoRunOnCommitChange,
  initialProjectStandardsPath,
  initialCliAgents,
  activeRepositoryPath,
  cmCliStatus,
  onInitializeTracking,
  onReadTrackingStatus,
  onRemoveTracking,
  onInstallCmCli,
  onRefreshCmCliStatus,
  onSave,
  onTestApiConnection,
  onSaveMaxChurn,
  onSaveAutoRunOnCommitChange,
  onSaveProjectStandardsPath,
  onSaveCliAgents,
  onTestCliConnection,
  onClose,
}: SettingsPanelProps) {
  const [draft, setDraft] = useState(initialApiKey);
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const [isApiKeyEditing, setIsApiKeyEditing] = useState(false);
  const [churnDraft, setChurnDraft] = useState(String(initialMaxChurn));
  const [autoRunOnCommitChange, setAutoRunOnCommitChange] = useState(
    initialAutoRunOnCommitChange,
  );
  const [projectStandardsPathDraft, setProjectStandardsPathDraft] = useState(initialProjectStandardsPath);
  const [cmCliActionError, setCmCliActionError] = useState<string | null>(null);
  const [cmCliActionMessage, setCmCliActionMessage] = useState<string | null>(null);
  const [isCmCliActionRunning, setIsCmCliActionRunning] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("projects");
  const [draftCliAgents, setDraftCliAgents] = useState<CliAgentsSettings>(initialCliAgents);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [agentEditDraft, setAgentEditDraft] = useState<AgentEditDraft | null>(null);
  const [apiConnectionStatus, setApiConnectionStatus] = useState<ConnectionStatus>("idle");
  const [apiConnectionMessage, setApiConnectionMessage] = useState<string | null>(null);
  const [cliConnectionStatus, setCliConnectionStatus] = useState<ConnectionStatus>("idle");
  const [cliConnectionMessage, setCliConnectionMessage] = useState<string | null>(null);
  const [testedCliAgentId, setTestedCliAgentId] = useState<string | null>(null);
  const [trackingStatus, setTrackingStatus] = useState<AgentTrackingStatus | null>(null);
  const [isTrackingStatusLoading, setIsTrackingStatusLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    setDraft(initialApiKey);
    setIsApiKeyVisible(false);
    setIsApiKeyEditing(initialApiKey.trim().length === 0);
    setChurnDraft(String(initialMaxChurn));
    setAutoRunOnCommitChange(initialAutoRunOnCommitChange);
    setProjectStandardsPathDraft(initialProjectStandardsPath);
    setCmCliActionError(null);
    setCmCliActionMessage(null);
    setIsCmCliActionRunning(false);
    setDraftCliAgents(initialCliAgents);
    setEditingAgentId(null);
    setAgentEditDraft(null);
    setApiConnectionStatus("idle");
    setApiConnectionMessage(null);
    setCliConnectionStatus("idle");
    setCliConnectionMessage(null);
    setTestedCliAgentId(null);
    setTrackingStatus(null);
    setIsTrackingStatusLoading(false);
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

  const activeCliAgent = useMemo(() => {
    if (!draftCliAgents.activeAgentId) {
      return null;
    }

    return draftCliAgents.agents.find((agent) => agent.id === draftCliAgents.activeAgentId) ?? null;
  }, [draftCliAgents]);

  const runApiConnectionTest = async (apiKeyOverride?: string) => {
    const apiKeyToTest = (apiKeyOverride ?? draft).trim();
    if (apiKeyToTest.length === 0) {
      setApiConnectionStatus("failed");
      setApiConnectionMessage("Add an API key before running a connection test.");
      return;
    }

    setApiConnectionStatus("testing");
    setApiConnectionMessage(null);

    try {
      const response = await onTestApiConnection(apiKeyToTest);
      const summary = toConnectionSummary(response);
      setApiConnectionStatus("connected");
      setApiConnectionMessage(
        summary.length > 0 ? `Connected. Provider response: ${summary}` : "Connected.",
      );
    } catch (error) {
      setApiConnectionStatus("failed");
      setApiConnectionMessage(getErrorMessage(error));
    }
  };

  const runCliConnectionTest = async (agentOverride?: CliAgentConfig | null) => {
    const agent = agentOverride ?? activeCliAgent;
    if (!agent) {
      setCliConnectionStatus("failed");
      setCliConnectionMessage("Select an active local agent before running a connection test.");
      setTestedCliAgentId(null);
      return;
    }

    setCliConnectionStatus("testing");
    setCliConnectionMessage(null);
    setTestedCliAgentId(agent.id);

    try {
      const response = await onTestCliConnection(
        agent,
        draftCliAgents.localTransport,
        activeRepositoryPath,
      );
      const summary = toConnectionSummary(response);
      setCliConnectionStatus("connected");
      setCliConnectionMessage(
        summary.length > 0
          ? `Connected via ${agent.name} (${draftCliAgents.localTransport.toUpperCase()}). Agent response: ${summary}`
          : `Connected via ${agent.name} (${draftCliAgents.localTransport.toUpperCase()}).`,
      );
    } catch (error) {
      setCliConnectionStatus("failed");
      setCliConnectionMessage(getErrorMessage(error));
    }
  };

  const saveApiKeyDraft = () => {
    const normalized = draft.trim();
    onSave(normalized);
    setDraft(normalized);
    setIsApiKeyEditing(false);

    if (normalized.length > 0) {
      void runApiConnectionTest(normalized);
    } else {
      setApiConnectionStatus("idle");
      setApiConnectionMessage(null);
    }
  };

  const stageApiKeyDraft = (value: string) => {
    const normalized = value.trim();
    if (normalized.length === 0) {
      setApiConnectionStatus("failed");
      setApiConnectionMessage("Clipboard is empty.");
      return;
    }

    setDraft(normalized);
    setIsApiKeyVisible(false);
    setIsApiKeyEditing(true);
    setApiConnectionStatus("idle");
    setApiConnectionMessage(null);
  };

  const pasteApiKeyFromClipboard = async () => {
    let desktopClipboardError: string | null = null;
    try {
      const clipboardValue = await readClipboardTextFromDesktop();
      stageApiKeyDraft(clipboardValue);
      return;
    } catch (error) {
      desktopClipboardError = getErrorMessage(error);
    }

    if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
      setApiConnectionStatus("failed");
      setApiConnectionMessage(
        desktopClipboardError
          ? `Unable to read clipboard: ${desktopClipboardError}`
          : "Clipboard access is unavailable. Focus the input and use Cmd/Ctrl+V.",
      );
      setIsApiKeyEditing(true);
      return;
    }

    try {
      const clipboardValue = await navigator.clipboard.readText();
      stageApiKeyDraft(clipboardValue);
    } catch (error) {
      const browserClipboardError = getErrorMessage(error);
      setApiConnectionStatus("failed");
      setApiConnectionMessage(
        desktopClipboardError
          ? `Unable to read clipboard. Desktop: ${desktopClipboardError}. Browser: ${browserClipboardError}.`
          : `Unable to read clipboard: ${browserClipboardError}`,
      );
      setIsApiKeyEditing(true);
    }
  };

  const setActiveCliAgent = (agentId: string) => {
    const next: CliAgentsSettings = { ...draftCliAgents, activeAgentId: agentId };
    setDraftCliAgents(next);
    onSaveCliAgents(next);

    const selectedAgent = next.agents.find((agent) => agent.id === agentId) ?? null;
    if (selectedAgent) {
      void runCliConnectionTest(selectedAgent);
      return;
    }

    setCliConnectionStatus("idle");
    setCliConnectionMessage(null);
    setTestedCliAgentId(null);
  };

  const setPreferredProvider = (preferredProvider: AiProviderPreference) => {
    const next: CliAgentsSettings = {
      ...draftCliAgents,
      preferredProvider,
    };
    setDraftCliAgents(next);
    onSaveCliAgents(next);
  };

  const toggleFallbackToSecondary = () => {
    const next: CliAgentsSettings = {
      ...draftCliAgents,
      fallbackToSecondary: !draftCliAgents.fallbackToSecondary,
    };
    setDraftCliAgents(next);
    onSaveCliAgents(next);
  };

  const setLocalTransport = (localTransport: LocalAgentTransport) => {
    const next: CliAgentsSettings = {
      ...draftCliAgents,
      localTransport,
    };
    setDraftCliAgents(next);
    onSaveCliAgents(next);

    if (activeCliAgent) {
      void runCliConnectionTest(activeCliAgent);
    } else {
      setCliConnectionStatus("idle");
      setCliConnectionMessage(null);
      setTestedCliAgentId(null);
    }
  };

  const startEditingAgent = (agent: CliAgentConfig) => {
    setEditingAgentId(agent.id);
    setAgentEditDraft({
      name: agent.name,
      acpCommand: agent.acpCommand,
      acpArgs: agent.acpArgs.join(" "),
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
            acpCommand: agentEditDraft.acpCommand.trim(),
            acpArgs: agentEditDraft.acpArgs
              .trim()
              .split(/\s+/)
              .filter((arg) => arg.length > 0),
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

    const updatedActiveAgent = next.agents.find((agent) => agent.id === next.activeAgentId) ?? null;
    if (updatedActiveAgent && updatedActiveAgent.id === editingAgentId) {
      void runCliConnectionTest(updatedActiveAgent);
    } else if (!updatedActiveAgent) {
      setCliConnectionStatus("idle");
      setCliConnectionMessage(null);
      setTestedCliAgentId(null);
    }

    setEditingAgentId(null);
    setAgentEditDraft(null);
  };

  const currentBackendLabel = useMemo(() => {
    const hasApiKey = draft.trim().length > 0;
    const activeAgent = activeCliAgent;
    const localLabel = activeAgent
      ? `${activeAgent.name} via ${draftCliAgents.localTransport.toUpperCase()}`
      : `Local agent via ${draftCliAgents.localTransport.toUpperCase()} (not selected)`;
    const apiLabel = hasApiKey ? "Anthropic API" : "Anthropic API (no key)";

    if (draftCliAgents.preferredProvider === "local-agent") {
      if (draftCliAgents.fallbackToSecondary && hasApiKey) {
        return `${localLabel} -> ${apiLabel}`;
      }

      return localLabel;
    }

    if (hasApiKey) {
      if (draftCliAgents.fallbackToSecondary && activeAgent) {
        return `${apiLabel} -> ${localLabel}`;
      }
      return apiLabel;
    }

    if (activeAgent) {
      return localLabel;
    }

    return "No API key or local agent configured";
  }, [
    activeCliAgent,
    draft,
    draftCliAgents.fallbackToSecondary,
    draftCliAgents.localTransport,
    draftCliAgents.preferredProvider,
  ]);

  const activeCliConnectionStatus: ConnectionStatus =
    activeCliAgent && testedCliAgentId === activeCliAgent.id ? cliConnectionStatus : "idle";
  const activeCliConnectionMessage =
    activeCliAgent && testedCliAgentId === activeCliAgent.id ? cliConnectionMessage : null;

  const hasActiveRepositoryPath = activeRepositoryPath.trim().length > 0;
  const isTrackingEnabled = Boolean(trackingStatus?.enabled);

  const refreshTrackingStatus = async () => {
    if (!hasActiveRepositoryPath) {
      setTrackingStatus(null);
      setIsTrackingStatusLoading(false);
      return;
    }

    setIsTrackingStatusLoading(true);
    try {
      const status = await onReadTrackingStatus(activeRepositoryPath);
      setTrackingStatus(status);
    } finally {
      setIsTrackingStatusLoading(false);
    }
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    if (!hasActiveRepositoryPath) {
      setTrackingStatus(null);
      setIsTrackingStatusLoading(false);
      return;
    }

    let cancelled = false;
    setIsTrackingStatusLoading(true);
    void onReadTrackingStatus(activeRepositoryPath)
      .then((status) => {
        if (cancelled) {
          return;
        }
        setTrackingStatus(status);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setTrackingStatus(null);
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setIsTrackingStatusLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeRepositoryPath, hasActiveRepositoryPath, onReadTrackingStatus, open]);

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
                  Initialize or remove repository tracking files using <code className="font-mono text-xs">cm init</code>{" "}
                  and <code className="font-mono text-xs">cm remove</code> behavior.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className={cn(
                      isTrackingEnabled
                        && "border-positive/55 bg-positive/18 text-positive hover:border-positive/70 hover:bg-positive/24",
                    )}
                    disabled={isCmCliActionRunning || isTrackingStatusLoading || !hasActiveRepositoryPath}
                    onClick={() => {
                      if (isTrackingEnabled) {
                        const confirmed = window.confirm(
                          "Tracking is currently enabled. Remove managed tracking files and hooks for this repository?",
                        );
                        if (!confirmed) {
                          return;
                        }
                        void runCmCliAction(async () => {
                          const result = await onRemoveTracking(activeRepositoryPath);
                          setCmCliActionMessage(result.message);
                          await refreshTrackingStatus();
                        });
                        return;
                      }

                      void runCmCliAction(async () => {
                        const result = await onInitializeTracking(activeRepositoryPath);
                        setCmCliActionMessage(result.message);
                        await refreshTrackingStatus();
                      });
                    }}
                  >
                    {isTrackingStatusLoading
                      ? "Checking Tracking..."
                      : isTrackingEnabled
                      ? "Tracking Enabled"
                      : "Initialize Tracking"}
                  </Button>
                </div>
                {isTrackingEnabled && (
                  <p className="text-xs text-positive">
                    Tracking is enabled. Click <strong>Tracking Enabled</strong> again to remove it.
                  </p>
                )}
                <p className="text-xs text-muted">
                  Ensures <code className="font-mono">AGENT.md</code> exists, updates the agent-reference
                  entry in <code className="font-mono">CLAUDE.md</code> (or equivalent), and writes{" "}
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
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={autoRunOnCommitChange}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      setAutoRunOnCommitChange(enabled);
                      onSaveAutoRunOnCommitChange(enabled);
                    }}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                  />
                  <div>
                    <p className="text-sm font-medium text-text">
                      Automatically run AI analysis on branch/commit change
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      When enabled, switching branch or commit re-runs AI analysis even if cached output
                      already exists.
                    </p>
                  </div>
                </label>
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

          {activeSection === "providers" && (
            <section className="space-y-4">
              <header>
                <h3 className="text-base font-semibold text-text">AI Providers</h3>
                <p className="text-sm text-muted">
                  Choose between the Anthropic API and a local agent. Local agents use ACP by
                  default for lower startup overhead and reusable sessions.
                </p>
              </header>

              <div className="space-y-3 border-y border-border/60 py-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Current Route</p>
                  <p className="font-mono text-xs text-text">{currentBackendLabel}</p>
                </div>

                <div className="grid gap-2 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setPreferredProvider("local-agent")}
                    className={cn(
                      "rounded-sm border px-3 py-2 text-left transition-colors",
                      draftCliAgents.preferredProvider === "local-agent"
                        ? "border-accent/55 bg-accent/10"
                        : "border-border/60 bg-surface-subtle/30 hover:bg-surface-subtle/45",
                    )}
                  >
                    <p className="text-sm font-medium text-text">Prefer Local Agent</p>
                    <p className="mt-0.5 text-xs text-muted">
                      Use the selected local agent first, then fall back to the API if enabled.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreferredProvider("api")}
                    className={cn(
                      "rounded-sm border px-3 py-2 text-left transition-colors",
                      draftCliAgents.preferredProvider === "api"
                        ? "border-accent/55 bg-accent/10"
                        : "border-border/60 bg-surface-subtle/30 hover:bg-surface-subtle/45",
                    )}
                  >
                    <p className="text-sm font-medium text-text">Prefer Anthropic API</p>
                    <p className="mt-0.5 text-xs text-muted">
                      Use the API first, then fall back to the configured local agent if enabled.
                    </p>
                  </button>
                </div>

                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={draftCliAgents.fallbackToSecondary}
                    onChange={toggleFallbackToSecondary}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                  />
                  <div>
                    <p className="text-sm font-medium text-text">Fall back to the secondary provider</p>
                    <p className="mt-0.5 text-xs text-muted">
                      Keeps analysis running if the preferred path is unavailable or the SDK is not installed.
                    </p>
                  </div>
                </label>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                <section className="space-y-3 rounded-sm border border-border/60 bg-surface-subtle/20 p-3">
                  <header className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold text-text">Local Agent</h4>
                      <div className="inline-flex items-center gap-1.5 rounded-sm border border-border/70 bg-canvas px-2 py-1">
                        <span
                          className={cn(
                            "h-2.5 w-2.5 rounded-full",
                            connectionStatusDotClass(activeCliConnectionStatus),
                          )}
                          aria-hidden="true"
                        />
                        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text">
                          {connectionStatusLabel(activeCliConnectionStatus)}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-muted">
                      ACP keeps a warm adapter process alive for repeated prompts. Switch to legacy CLI only if the ACP adapter is unavailable.
                    </p>
                  </header>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant={draftCliAgents.localTransport === "acp" ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setLocalTransport("acp")}
                    >
                      ACP
                    </Button>
                    <Button
                      variant={draftCliAgents.localTransport === "cli" ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setLocalTransport("cli")}
                    >
                      Legacy CLI
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!activeCliAgent || activeCliConnectionStatus === "testing"}
                      onClick={() => {
                        void runCliConnectionTest();
                      }}
                    >
                      {activeCliConnectionStatus === "testing" ? "Testing..." : "Test Local Agent"}
                    </Button>
                  </div>
                  {!activeCliAgent && (
                    <p className="text-xs text-muted">
                      Select an active local agent before running a connection test.
                    </p>
                  )}
                  {activeCliConnectionMessage && (
                    <p
                      className={cn(
                        "text-xs",
                        activeCliConnectionStatus === "failed" ? "text-danger" : "text-muted",
                      )}
                    >
                      {activeCliConnectionMessage}
                    </p>
                  )}

                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Available Agents</p>
                    {draftCliAgents.agents.map((agent) => {
                      const isActive = agent.id === draftCliAgents.activeAgentId;
                      const isEditing = agent.id === editingAgentId;

                      return (
                        <div
                          key={agent.id}
                          className="rounded-sm border border-border/60 bg-canvas/60 px-2.5 py-2"
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
                                <label className="text-xs text-muted">ACP</label>
                                <Input
                                  value={agentEditDraft.acpCommand}
                                  onChange={(event) => {
                                    setAgentEditDraft({
                                      ...agentEditDraft,
                                      acpCommand: event.target.value,
                                    });
                                  }}
                                  className="h-7 font-mono text-xs"
                                  placeholder="e.g. claude-code-acp"
                                />
                                <label className="text-xs text-muted">ACP args</label>
                                <Input
                                  value={agentEditDraft.acpArgs}
                                  onChange={(event) => {
                                    setAgentEditDraft({
                                      ...agentEditDraft,
                                      acpArgs: event.target.value,
                                    });
                                  }}
                                  className="h-7 font-mono text-xs"
                                  placeholder="Optional ACP adapter arguments"
                                />
                                <label className="text-xs text-muted">CLI</label>
                                <Input
                                  value={agentEditDraft.command}
                                  onChange={(event) => {
                                    setAgentEditDraft({ ...agentEditDraft, command: event.target.value });
                                  }}
                                  className="h-7 font-mono text-xs"
                                  placeholder="e.g. codex"
                                />
                                <label className="text-xs text-muted">CLI args</label>
                                <Input
                                  value={agentEditDraft.promptArgs}
                                  onChange={(event) => {
                                    setAgentEditDraft({
                                      ...agentEditDraft,
                                      promptArgs: event.target.value,
                                    });
                                  }}
                                  className="h-7 font-mono text-xs"
                                  placeholder="exec  (space-separated, placed before the prompt)"
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
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm font-medium text-text">{agent.name}</span>
                                  {isActive && (
                                    <span className="rounded-sm border border-accent/40 bg-accent/12 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-accent">
                                      active
                                    </span>
                                  )}
                                </div>
                                <p className="truncate font-mono text-xs text-muted">
                                  ACP: {agent.acpCommand || "not configured"}
                                  {agent.acpArgs.length > 0 ? ` ${agent.acpArgs.join(" ")}` : ""}
                                </p>
                                <p className="truncate font-mono text-xs text-muted">
                                  CLI: {agent.command}
                                  {agent.promptArgs.length > 0 ? ` ${agent.promptArgs.join(" ")}` : ""}
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
                </section>

                <section className="space-y-3 rounded-sm border border-border/60 bg-surface-subtle/20 p-3">
                  <header className="space-y-1">
                    <h4 className="text-sm font-semibold text-text">Anthropic API</h4>
                    <p className="text-xs text-muted">
                      Use the API as a primary provider or as the secondary path behind the local agent.
                    </p>
                  </header>

                  <div className="space-y-2">
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
                            if (
                              (event.metaKey || event.ctrlKey)
                              && !event.shiftKey
                              && !event.altKey
                              && event.key.toLowerCase() === "v"
                            ) {
                              event.preventDefault();
                              void pasteApiKeyFromClipboard();
                              return;
                            }

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
                          onPaste={(event) => {
                            const pasted = event.clipboardData.getData("text");
                            if (!pasted || pasted.trim().length === 0) {
                              return;
                            }
                            event.preventDefault();
                            stageApiKeyDraft(pasted);
                          }}
                          placeholder="sk-ant-..."
                          aria-label="Anthropic API key"
                          className="font-mono text-xs"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            void pasteApiKeyFromClipboard();
                          }}
                        >
                          Paste
                        </Button>
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
                              setIsApiKeyEditing(true);
                              return;
                            }
                            setIsApiKeyVisible((current) => !current);
                          }}
                          onPaste={(event) => {
                            const pasted = event.clipboardData.getData("text");
                            if (!pasted || pasted.trim().length === 0) {
                              return;
                            }
                            event.preventDefault();
                            stageApiKeyDraft(pasted);
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
                          onClick={() => {
                            void pasteApiKeyFromClipboard();
                          }}
                        >
                          Paste
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 w-9 shrink-0 px-0 text-danger hover:text-danger"
                          onClick={() => {
                            setDraft("");
                            setIsApiKeyVisible(false);
                            onSave("");
                            setApiConnectionStatus("idle");
                            setApiConnectionMessage(null);
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
                      Stored in localStorage for now. Click the key to toggle visibility.
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <div className="inline-flex items-center gap-1.5 rounded-sm border border-border/70 bg-canvas px-2 py-1">
                        <span
                          className={cn("h-2.5 w-2.5 rounded-full", connectionStatusDotClass(apiConnectionStatus))}
                          aria-hidden="true"
                        />
                        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text">
                          {connectionStatusLabel(apiConnectionStatus)}
                        </span>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={apiConnectionStatus === "testing" || draft.trim().length === 0}
                        onClick={() => {
                          void runApiConnectionTest();
                        }}
                      >
                        {apiConnectionStatus === "testing" ? "Testing..." : "Test API"}
                      </Button>
                    </div>
                    {apiConnectionMessage && (
                      <p className={cn("text-xs", apiConnectionStatus === "failed" ? "text-danger" : "text-muted")}>
                        {apiConnectionMessage}
                      </p>
                    )}
                  </div>
                </section>
              </div>
            </section>
          )}
        </div>
      </div>
    </Modal>
  );
}
