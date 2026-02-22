import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AppFrame,
  Badge,
  Button,
  Card,
  CardBody,
} from "../../../design-system/index.ts";
import {
  clearApiKeyFromStorage,
  DEFAULT_AI_ANALYSIS_CONFIG,
  openProjectInNewWindow,
  readAiAnalysisConfigFromStorage,
  readApiKeyFromStorage,
  readRecentProjectsFromStorage,
  readReviewerProfileFromStorage,
  recordRecentProjectInStorage,
  projectLabelFromPath,
  selectRepositoryFolder,
  writeAiAnalysisConfigToStorage,
  writeApiKeyToStorage,
  writeReviewerProfileToStorage,
} from "../../../shared/index.ts";
import { DEFAULT_LOAD_REQUEST, DEFAULT_STANDARDS_RULE_TEXT, REVIEW_TABS } from "../constants.ts";
import {
  ChangedFilesSidebar,
  CommandPalette,
  type CommandPaletteItem,
  DiffViewer,
  HomeScreen,
  OverviewPanel,
  SettingsPanel,
  StandardsPanel,
  SummaryPanel,
  TopTabs,
} from "../components/index.ts";
import { useReviewWorkspace } from "../hooks/useReviewWorkspace.ts";
import type { ReviewTabId } from "../types.ts";

function normalizeInputValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveLaunchRequestFromLocation(): {
  readonly repositoryPath: string;
  readonly commitSha: string;
} | null {
  if (typeof window === "undefined") {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const repositoryPath = params.get("repo")?.trim() ?? "";
  if (repositoryPath.length === 0) {
    return null;
  }

  const commitSha = params.get("commit")?.trim() ?? DEFAULT_LOAD_REQUEST.commitSha;
  return {
    repositoryPath,
    commitSha: commitSha.length > 0 ? commitSha : DEFAULT_LOAD_REQUEST.commitSha,
  };
}

function reviewerAuthorIdFromProfile(name: string, email: string): string {
  const normalizedName = normalizeInputValue(name);
  const normalizedEmail = normalizeInputValue(email);

  if (normalizedName.length > 0 && normalizedEmail.length > 0) {
    return `${normalizedName} <${normalizedEmail}>`;
  }

  if (normalizedName.length > 0) {
    return normalizedName;
  }

  if (normalizedEmail.length > 0) {
    return normalizedEmail;
  }

  return "reviewer-1";
}

export function ReviewWorkspaceContainer() {
  const { state, actions } = useReviewWorkspace();
  const launchRequestFromLocation = useMemo(resolveLaunchRequestFromLocation, []);
  const savedReviewerProfile = useMemo(() => readReviewerProfileFromStorage(), []);

  const [activeTab, setActiveTab] = useState<ReviewTabId>("files");
  const [highlightedFileIds, setHighlightedFileIds] = useState<readonly string[]>([]);
  const [commitShaInput, setCommitShaInput] = useState(DEFAULT_LOAD_REQUEST.commitSha);
  const [startupRepositoryPath, setStartupRepositoryPath] = useState(() => {
    if (launchRequestFromLocation?.repositoryPath) {
      return launchRequestFromLocation.repositoryPath;
    }

    return readRecentProjectsFromStorage()[0]?.repositoryPath ?? DEFAULT_LOAD_REQUEST.repositoryPath;
  });
  const [startupCommitSha, setStartupCommitSha] = useState(
    launchRequestFromLocation?.commitSha ?? DEFAULT_LOAD_REQUEST.commitSha,
  );
  const [reviewerName, setReviewerName] = useState(savedReviewerProfile?.name ?? "");
  const [reviewerEmail, setReviewerEmail] = useState(savedReviewerProfile?.email ?? "");
  const [recentProjects, setRecentProjects] = useState(() => readRecentProjectsFromStorage());
  const [startupMessage, setStartupMessage] = useState<string | null>(null);
  const [isStartingFromHome, setIsStartingFromHome] = useState(false);
  const [hasAttemptedAutoStart, setHasAttemptedAutoStart] = useState(false);
  const [showInlineComments, setShowInlineComments] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [storedApiKey, setStoredApiKey] = useState(() => readApiKeyFromStorage() ?? "");
  const [maxChurnThreshold, setMaxChurnThreshold] = useState(
    () => readAiAnalysisConfigFromStorage().maxChurnThreshold,
  );
  const [sidebarFocus, setSidebarFocus] = useState<{
    readonly label: string;
    readonly fileIds: readonly string[];
  } | null>(null);

  useEffect(() => {
    if (!state.commit?.commitSha) {
      return;
    }

    setCommitShaInput(state.commit.commitSha);
  }, [state.commit?.commitSha]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "p") {
        return;
      }

      event.preventDefault();
      setShowCommandPalette(true);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const totalAdditions = useMemo(() => {
    return state.allFiles.reduce((count, file) => count + file.additions, 0);
  }, [state.allFiles]);

  const totalDeletions = useMemo(() => {
    return state.allFiles.reduce((count, file) => count + file.deletions, 0);
  }, [state.allFiles]);

  const sidebarFiles = useMemo(() => {
    if (!sidebarFocus) {
      return state.filteredFiles;
    }

    const focusedFileIds = new Set(sidebarFocus.fileIds);
    return state.filteredFiles.filter((file) => focusedFileIds.has(file.id));
  }, [sidebarFocus, state.filteredFiles]);

  const commandEntries = useMemo<
    readonly {
      readonly item: CommandPaletteItem;
      readonly action:
        | { readonly kind: "tab"; readonly tabId: ReviewTabId }
        | { readonly kind: "file"; readonly fileId: string }
        | { readonly kind: "settings" }
        | { readonly kind: "open-project-new-window" }
        | { readonly kind: "commit"; readonly commitSha: string };
    }[]
  >(() => {
    const entries: Array<{
      readonly item: CommandPaletteItem;
      readonly action:
        | { readonly kind: "tab"; readonly tabId: ReviewTabId }
        | { readonly kind: "file"; readonly fileId: string }
        | { readonly kind: "settings" }
        | { readonly kind: "open-project-new-window" }
        | { readonly kind: "commit"; readonly commitSha: string };
    }> = [];

    state.allFiles.slice(0, 220).forEach((file) => {
      entries.push({
        item: {
          id: `file:${file.id}`,
          label: file.path,
          detail: `${file.status}  +${file.additions}/-${file.deletions}`,
          section: "diff-sections",
          keywords: [file.status, file.path],
        },
        action: {
          kind: "file",
          fileId: file.id,
        },
      });
    });

    REVIEW_TABS.forEach((tab) => {
      entries.push({
        item: {
          id: `tab:${tab.id}`,
          label: tab.label,
          detail: "Switch section",
          section: "diff-sections",
          keywords: ["tab", "section", tab.id],
        },
        action: {
          kind: "tab",
          tabId: tab.id,
        },
      });
    });

    entries.push({
      item: {
        id: "cmd:open-project-new-window",
        label: "Open Project in New Window",
        detail: "Pick a repository and launch an isolated workspace window",
        section: "settings",
        keywords: ["open", "project", "window", "repository"],
      },
      action: {
        kind: "open-project-new-window",
      },
    });

    entries.push({
      item: {
        id: "cmd:settings",
        label: "Open Settings",
        detail: "Configure API key and runtime defaults",
        section: "settings",
        keywords: ["settings", "api", "preferences"],
      },
      action: {
        kind: "settings",
      },
    });

    state.repositoryCommits.slice(0, 120).forEach((commit) => {
      entries.push({
        item: {
          id: `commit:${commit.hash}`,
          label: `${commit.shortHash} ${commit.summary}`,
          detail: `${commit.author} · ${commit.authoredAtIso}`,
          section: "commits",
          keywords: [commit.hash, commit.shortHash, commit.summary, "commit"],
        },
        action: {
          kind: "commit",
          commitSha: commit.hash,
        },
      });
    });

    return entries;
  }, [state.allFiles, state.repositoryCommits]);

  const commandItems = useMemo(() => commandEntries.map((entry) => entry.item), [commandEntries]);
  const commandActionById = useMemo(
    () => new Map(commandEntries.map((entry) => [entry.item.id, entry.action] as const)),
    [commandEntries],
  );

  const reviewerAuthorId = useMemo(() => {
    return reviewerAuthorIdFromProfile(reviewerName, reviewerEmail);
  }, [reviewerEmail, reviewerName]);

  const hasSavedReviewerProfile = useMemo(() => {
    const normalizedName = normalizeInputValue(reviewerName);
    const normalizedEmail = normalizeInputValue(reviewerEmail);
    return normalizedName.length > 0 && normalizedEmail.length > 0;
  }, [reviewerEmail, reviewerName]);

  const hasSavedRepositoryPath = useMemo(() => {
    return normalizeInputValue(startupRepositoryPath).length > 0;
  }, [startupRepositoryPath]);

  const shouldAutoStart = hasSavedReviewerProfile && hasSavedRepositoryPath;

  const activeRepositoryPath = useMemo(() => {
    const fromCommit = state.commit?.repositoryPath?.trim();
    return fromCommit && fromCommit.length > 0
      ? fromCommit
      : normalizeInputValue(startupRepositoryPath) || DEFAULT_LOAD_REQUEST.repositoryPath;
  }, [startupRepositoryPath, state.commit?.repositoryPath]);

  useEffect(() => {
    const projectLabel = projectLabelFromPath(activeRepositoryPath) || "CodeLens";
    document.title = projectLabel;

    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      return;
    }

    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(projectLabel))
      .catch(() => {
        // Ignore title update failures when runtime window APIs are unavailable.
      });
  }, [activeRepositoryPath]);

  const launchWorkspace = useCallback(
    (repositoryPath: string, commitSha: string) => {
      const normalizedRepositoryPath = normalizeInputValue(repositoryPath);
      const normalizedCommitSha = normalizeInputValue(commitSha) || DEFAULT_LOAD_REQUEST.commitSha;

      if (normalizedRepositoryPath.length === 0) {
        return;
      }

      setHighlightedFileIds([]);
      setSidebarFocus(null);
      setActiveTab("files");
      actions.reloadReviewWorkspace({
        repositoryPath: normalizedRepositoryPath,
        commitSha: normalizedCommitSha,
        standardsRuleText: DEFAULT_STANDARDS_RULE_TEXT,
      });
    },
    [actions],
  );

  const recordRecentProject = useCallback((repositoryPath: string) => {
    const nextRecentProjects = recordRecentProjectInStorage(repositoryPath);
    setRecentProjects(nextRecentProjects);
    return nextRecentProjects;
  }, []);

  const triggerCommitReload = useCallback(
    (commitSha: string) => {
      const normalizedCommitSha = commitSha.trim();
      if (normalizedCommitSha.length === 0) {
        return;
      }

      launchWorkspace(activeRepositoryPath, normalizedCommitSha);
    },
    [activeRepositoryPath, launchWorkspace],
  );

  const startReviewFromHome = useCallback(
    (overrideRepositoryPath?: string) => {
      const normalizedName = normalizeInputValue(reviewerName);
      const normalizedEmail = normalizeInputValue(reviewerEmail);
      const repositoryPathCandidate =
        typeof overrideRepositoryPath === "string" ? overrideRepositoryPath : startupRepositoryPath;
      const normalizedRepositoryPath = normalizeInputValue(repositoryPathCandidate);
      const normalizedCommitSha = normalizeInputValue(startupCommitSha) || DEFAULT_LOAD_REQUEST.commitSha;

      if (normalizedName.length === 0 || normalizedEmail.length === 0) {
        setStartupMessage("Set your reviewer name and email before starting a review.");
        return;
      }

      if (normalizedRepositoryPath.length === 0) {
        setStartupMessage("Select a repository folder before starting.");
        return;
      }

      writeReviewerProfileToStorage({
        name: normalizedName,
        email: normalizedEmail,
      });
      setReviewerName(normalizedName);
      setReviewerEmail(normalizedEmail);

      recordRecentProject(normalizedRepositoryPath);
      setStartupRepositoryPath(normalizedRepositoryPath);

      setStartupMessage(null);
      setIsStartingFromHome(true);
      launchWorkspace(normalizedRepositoryPath, normalizedCommitSha);
    },
    [
      launchWorkspace,
      recordRecentProject,
      reviewerEmail,
      reviewerName,
      startupCommitSha,
      startupRepositoryPath,
    ],
  );

  const browseHomeRepository = useCallback(async () => {
    const selectedPath = await selectRepositoryFolder();
    if (!selectedPath) {
      return;
    }

    setStartupRepositoryPath(selectedPath);
    setStartupMessage(null);
  }, []);

  const openProjectInCurrentWindow = useCallback(async () => {
    const selectedPath = await selectRepositoryFolder();
    if (!selectedPath) {
      return;
    }

    const normalizedPath = normalizeInputValue(selectedPath);
    if (normalizedPath.length === 0) {
      return;
    }

    setShowSettings(false);
    setCommitShaInput(DEFAULT_LOAD_REQUEST.commitSha);
    setStartupRepositoryPath(normalizedPath);
    setStartupCommitSha(DEFAULT_LOAD_REQUEST.commitSha);
    setStartupMessage(null);
    recordRecentProject(normalizedPath);
    launchWorkspace(normalizedPath, DEFAULT_LOAD_REQUEST.commitSha);
  }, [launchWorkspace, recordRecentProject]);

  const openProjectInNewWindowWithPicker = useCallback(async () => {
    const selectedPath = await selectRepositoryFolder();
    if (!selectedPath) {
      return;
    }

    const normalizedPath = normalizeInputValue(selectedPath);
    if (normalizedPath.length === 0) {
      return;
    }

    recordRecentProject(normalizedPath);
    await openProjectInNewWindow({
      repositoryPath: normalizedPath,
      commitSha: DEFAULT_LOAD_REQUEST.commitSha,
    });
    setShowSettings(false);
  }, [recordRecentProject]);

  const openRecentProjectInCurrentWindow = useCallback(
    (repositoryPath: string) => {
      const normalizedPath = normalizeInputValue(repositoryPath);
      if (normalizedPath.length === 0) {
        return;
      }

      setShowSettings(false);
      setCommitShaInput(DEFAULT_LOAD_REQUEST.commitSha);
      setStartupRepositoryPath(normalizedPath);
      setStartupCommitSha(DEFAULT_LOAD_REQUEST.commitSha);
      setStartupMessage(null);
      recordRecentProject(normalizedPath);
      launchWorkspace(normalizedPath, DEFAULT_LOAD_REQUEST.commitSha);
    },
    [launchWorkspace, recordRecentProject],
  );

  const openRecentProjectInNewWindow = useCallback(
    async (repositoryPath: string) => {
      const normalizedPath = normalizeInputValue(repositoryPath);
      if (normalizedPath.length === 0) {
        return;
      }

      recordRecentProject(normalizedPath);
      await openProjectInNewWindow({
        repositoryPath: normalizedPath,
        commitSha: DEFAULT_LOAD_REQUEST.commitSha,
      });
      setShowSettings(false);
    },
    [recordRecentProject],
  );

  useEffect(() => {
    if (!isStartingFromHome) {
      return;
    }

    if (state.loadStatus === "loading") {
      return;
    }

    setIsStartingFromHome(false);
  }, [isStartingFromHome, state.loadStatus]);

  useEffect(() => {
    if (hasAttemptedAutoStart || state.loadStatus !== "idle" || state.commit) {
      return;
    }

    setHasAttemptedAutoStart(true);

    if (!shouldAutoStart) {
      return;
    }

    startReviewFromHome(launchRequestFromLocation?.repositoryPath);
  }, [
    hasAttemptedAutoStart,
    launchRequestFromLocation?.repositoryPath,
    shouldAutoStart,
    startReviewFromHome,
    state.commit,
    state.loadStatus,
  ]);

  useEffect(() => {
    const handleOpenNewProjectWindowShortcut = (event: KeyboardEvent) => {
      const hasCommandModifier = event.metaKey || event.ctrlKey;
      if (!hasCommandModifier || !event.shiftKey || event.altKey) {
        return;
      }

      if (event.key.toLowerCase() !== "n") {
        return;
      }

      event.preventDefault();
      void openProjectInNewWindowWithPicker().catch((error) => {
        console.error(error);
      });
    };

    window.addEventListener("keydown", handleOpenNewProjectWindowShortcut);
    return () => {
      window.removeEventListener("keydown", handleOpenNewProjectWindowShortcut);
    };
  }, [openProjectInNewWindowWithPicker]);

  const handleTabChange = useCallback((tabId: ReviewTabId) => {
    setActiveTab(tabId);

    if (tabId !== "overview") {
      setSidebarFocus(null);
    }
  }, []);

  const runCommand = useCallback(
    async (item: CommandPaletteItem) => {
      const action = commandActionById.get(item.id);
      if (!action) {
        return;
      }

      if (action.kind === "tab") {
        setActiveTab(action.tabId);
        return;
      }

      if (action.kind === "file") {
        setHighlightedFileIds([action.fileId]);
        actions.selectFile(action.fileId);
        setActiveTab("files");
        return;
      }

      if (action.kind === "commit") {
        setCommitShaInput(action.commitSha);
        triggerCommitReload(action.commitSha);
        return;
      }

      if (action.kind === "settings") {
        setShowSettings(true);
        return;
      }

      await openProjectInNewWindowWithPicker();
    },
    [actions, commandActionById, openProjectInNewWindowWithPicker, triggerCommitReload],
  );

  useEffect(() => {
    if (activeTab === "overview") {
      setIsSidebarCollapsed(true);
      return;
    }

    setIsSidebarCollapsed(false);
  }, [activeTab]);

  const header = (
    <header className="border-b border-border/70 bg-surface/95">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-sm border border-accent/35 bg-accent/12 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
              CodeLens
            </span>
            {state.commit && <Badge tone="accent">{state.commit.shortSha}</Badge>}
            <Badge tone="positive">+{totalAdditions}</Badge>
            <Badge tone="danger">-{totalDeletions}</Badge>
          </div>

          <p className="truncate text-sm font-semibold tracking-tight text-text">
            {state.commit ? state.commit.title : "Code Review Workspace"}
          </p>
          <p className="truncate font-mono text-[11px] text-muted">
            {state.commit
              ? `${state.commit.authorName} · ${state.commit.authorEmail} · ${activeRepositoryPath}`
              : activeRepositoryPath}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <label className="sr-only" htmlFor="commitPicker">
            Repository commits
          </label>
          <select
            id="commitPicker"
            className="h-8 max-w-[22rem] min-w-[14rem] rounded-md border border-border bg-canvas px-2 font-mono text-xs text-text shadow-inset"
            value={commitShaInput}
            onChange={(event) => {
              const nextCommitSha = event.target.value;
              if (nextCommitSha.length === 0) {
                return;
              }

              setCommitShaInput(nextCommitSha);
              triggerCommitReload(nextCommitSha);
            }}
            aria-label="Repository commit selection"
            title="Repository commits"
          >
            {!state.repositoryCommits.some((commit) => commit.hash === commitShaInput) && (
              <option value={commitShaInput}>{commitShaInput}</option>
            )}
            {state.repositoryCommits.map((commit) => (
              <option key={commit.hash} value={commit.hash}>
                {commit.shortHash} - {commit.summary}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSettings(true)}
            aria-label="Open settings"
            title="Settings"
            className="h-9 w-9 px-0"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Button>
          <Button
            size="sm"
            onClick={actions.publishReview}
            disabled={!state.isPublishingReady || state.publishStatus === "publishing"}
          >
            {state.publishStatus === "publishing" ? "Publishing..." : "Publish Review"}
          </Button>
        </div>
      </div>

      {(state.publishError || state.publishResult) && (
        <div className="border-b border-border px-4 py-1 text-xs">
          {state.publishError ? (
            <p className="text-danger">Claude publish failed: {state.publishError}</p>
          ) : (
            <p className="truncate text-muted">
              Claude published `{state.publishResult?.publicationId}`: {state.publishResult?.summary}
            </p>
          )}
        </div>
      )}

      <TopTabs
        tabs={REVIEW_TABS}
        activeTab={activeTab}
        onChange={handleTabChange}
        trailingAction={(
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsSidebarCollapsed((current) => !current)}
            className="h-9 gap-2 px-2 text-text"
            aria-label={isSidebarCollapsed ? "Show changed files sidebar" : "Hide changed files sidebar"}
            title={isSidebarCollapsed ? "Show files" : "Hide files"}
          >
            {isSidebarCollapsed ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="19"
                height="19"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="2" y="2" width="16" height="16" rx="2.5" />
                <path d="M6.5 2v16" />
                <path d="M10 10h5.5" />
                <path d="M12.75 7.25v5.5" />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="19"
                height="19"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="2" y="2" width="16" height="16" rx="2.5" />
                <path d="M6.5 2v16" />
                <path d="M10 10h5.5" />
              </svg>
            )}
            <span className="hidden font-mono text-[11px] uppercase tracking-[0.08em] sm:inline">
              {isSidebarCollapsed ? "Show Files" : "Hide Files"}
            </span>
          </Button>
        )}
      />
    </header>
  );

  const mainContent = useMemo(() => {
    if (state.loadStatus === "loading" || state.loadStatus === "idle") {
      return (
        <Card className="h-full rounded-none border-0 shadow-none">
          <CardBody className="flex h-full items-center justify-center py-10 text-sm text-muted">
            Loading commit review data and standards checks...
          </CardBody>
        </Card>
      );
    }

    if (state.loadStatus === "error") {
      return (
        <Card className="h-full rounded-none border-0 shadow-none">
          <CardBody className="flex h-full items-center justify-center py-10 text-sm text-danger">
            {state.errorMessage ?? "Failed to load review data."}
          </CardBody>
        </Card>
      );
    }

    if (activeTab === "overview") {
      return (
        <OverviewPanel
          overviewCards={state.overviewCards}
          architectureClusters={state.architectureClusters}
          sequencePairs={state.sequencePairs}
          codeSequenceSteps={state.codeSequenceSteps}
          aiAnalysisStatus={state.aiAnalysisStatus}
          sequenceGenerationStatus={state.aiSequenceStatus}
          sequenceGenerationError={state.aiSequenceError}
          onRefreshAiAnalysis={actions.refreshAiAnalysis}
          onRetrySequenceGeneration={actions.retrySequenceGeneration}
          highlightedFileIds={highlightedFileIds}
          onSelectFiles={(selection) => {
            setHighlightedFileIds(selection.fileIds);
            setSidebarFocus({
              label: selection.label ?? "Focused",
              fileIds: selection.fileIds,
            });
            actions.selectFile(selection.fileIds[0] ?? null);
          }}
        />
      );
    }

    if (activeTab === "files") {
      return (
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1">
            <DiffViewer
              file={state.activeFile}
              hunks={state.activeFileHunks}
              threads={state.threadModels}
              showInlineThreads={showInlineComments}
              orientation={state.diffOrientation}
              viewMode={state.diffViewMode}
              fileVersions={state.activeFileVersions}
              fileVersionsStatus={state.activeFileVersionsStatus}
              fileVersionsError={state.activeFileVersionsError}
              onOrientationChange={actions.setDiffOrientation}
              onViewModeChange={actions.setDiffViewMode}
              onAskAgent={actions.askAgent}
              onDeleteComment={actions.deleteComment}
              onCreateThread={actions.createThread}
              defaultAuthorId={reviewerAuthorId}
              toolbarActions={(
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowInlineComments((current) => !current)}
                  className="h-7 px-2"
                >
                  {showInlineComments ? "Hide Comments" : "Show Comments"}
                </Button>
              )}
            />
          </div>
        </div>
      );
    }

    if (activeTab === "summary") {
      return (
        <div className="h-full overflow-auto p-3 xl:p-4">
          <SummaryPanel
            commit={state.commit}
            overviewCards={state.overviewCards}
            fileSummaries={state.fileSummaries}
            publishPackage={state.publishPackage}
            publishStatus={state.publishStatus}
            publishResult={state.publishResult}
            publishError={state.publishError}
            canPublish={state.isPublishingReady}
            onPublishReview={actions.publishReview}
          />
        </div>
      );
    }

    return (
      <div className="h-full overflow-auto p-3 xl:p-4">
        <StandardsPanel checks={state.standardsChecks} counts={state.standardsCounts} />
      </div>
    );
  }, [
    actions,
    activeTab,
    highlightedFileIds,
    state.activeFile,
    state.activeFileHunks,
    state.activeFileVersions,
    state.activeFileVersionsStatus,
    state.activeFileVersionsError,
    state.commit,
    state.diffOrientation,
    state.diffViewMode,
    state.errorMessage,
    state.fileSummaries,
    state.isPublishingReady,
    state.loadStatus,
    state.overviewCards,
    state.publishPackage,
    state.publishStatus,
    state.publishResult,
    state.publishError,
    state.sequencePairs,
    state.codeSequenceSteps,
    state.aiAnalysisStatus,
    state.aiSequenceStatus,
    state.aiSequenceError,
    state.standardsChecks,
    state.standardsCounts,
    state.threadModels,
    state.architectureClusters,
    state.repositoryCommits,
    showInlineComments,
    reviewerAuthorId,
    commitShaInput,
    activeRepositoryPath,
    triggerCommitReload,
    isSidebarCollapsed,
  ]);

  const isAutoStartingBeforeInitialRender =
    state.commit === null &&
    state.loadStatus === "idle" &&
    !hasAttemptedAutoStart &&
    shouldAutoStart;

  const showHomeScreen =
    state.commit === null &&
    state.loadStatus !== "loading" &&
    !isAutoStartingBeforeInitialRender;

  if (showHomeScreen) {
    return (
      <>
        <HomeScreen
          reviewerName={reviewerName}
          reviewerEmail={reviewerEmail}
          repositoryPath={startupRepositoryPath}
          commitSha={startupCommitSha}
          recentProjects={recentProjects}
          errorMessage={startupMessage ?? state.errorMessage}
          isStarting={isStartingFromHome}
          onReviewerNameChange={(value) => {
            setReviewerName(value);
            setStartupMessage(null);
          }}
          onReviewerEmailChange={(value) => {
            setReviewerEmail(value);
            setStartupMessage(null);
          }}
          onRepositoryPathChange={(value) => {
            setStartupRepositoryPath(value);
            setStartupMessage(null);
          }}
          onCommitShaChange={(value) => {
            setStartupCommitSha(value);
            setStartupMessage(null);
          }}
          onBrowseRepository={browseHomeRepository}
          onSelectRecentProject={(repositoryPath) => {
            setStartupRepositoryPath(repositoryPath);
            startReviewFromHome(repositoryPath);
          }}
          onStart={startReviewFromHome}
        />
        <SettingsPanel
          open={showSettings}
          initialApiKey={storedApiKey}
          initialMaxChurn={maxChurnThreshold}
          activeRepositoryPath={activeRepositoryPath}
          recentProjects={recentProjects}
          onOpenProjectInCurrentWindow={openProjectInCurrentWindow}
          onOpenProjectInNewWindow={openProjectInNewWindowWithPicker}
          onOpenRecentProjectInCurrentWindow={openRecentProjectInCurrentWindow}
          onOpenRecentProjectInNewWindow={openRecentProjectInNewWindow}
          onSave={(key) => {
            const trimmed = key.trim();
            if (trimmed.length > 0) {
              writeApiKeyToStorage(trimmed);
            } else {
              clearApiKeyFromStorage();
            }
            setStoredApiKey(trimmed);
            setShowSettings(false);
          }}
          onSaveMaxChurn={(n) => {
            writeAiAnalysisConfigToStorage({ maxChurnThreshold: n });
            setMaxChurnThreshold(n);
          }}
          onClose={() => setShowSettings(false)}
        />
      </>
    );
  }

  return (
    <>
      <AppFrame
        sidebarPosition="left"
        sidebarCollapsed={isSidebarCollapsed}
        header={header}
        sidebar={
          <ChangedFilesSidebar
            files={sidebarFiles}
            allFiles={state.allFiles}
            allFilesCount={state.allFiles.length}
            activeFileId={state.activeFileId}
            highlightedFileIds={highlightedFileIds}
            filter={state.fileFilter}
            filterLabel={sidebarFocus?.label ?? null}
            onClearFilter={() => setSidebarFocus(null)}
            onQueryChange={actions.setFilterQuery}
            onSelectFile={(fileId) => {
              setHighlightedFileIds([fileId]);
              actions.selectFile(fileId);
              setActiveTab("files");
            }}
          />
        }
      >
        {mainContent}
      </AppFrame>
      <SettingsPanel
        open={showSettings}
        initialApiKey={storedApiKey}
        initialMaxChurn={maxChurnThreshold}
        activeRepositoryPath={activeRepositoryPath}
        recentProjects={recentProjects}
        onOpenProjectInCurrentWindow={openProjectInCurrentWindow}
        onOpenProjectInNewWindow={openProjectInNewWindowWithPicker}
        onOpenRecentProjectInCurrentWindow={openRecentProjectInCurrentWindow}
        onOpenRecentProjectInNewWindow={openRecentProjectInNewWindow}
        onSave={(key) => {
          const trimmed = key.trim();
          if (trimmed.length > 0) {
            writeApiKeyToStorage(trimmed);
          } else {
            clearApiKeyFromStorage();
          }
          setStoredApiKey(trimmed);
          setShowSettings(false);
        }}
        onSaveMaxChurn={(n) => {
          writeAiAnalysisConfigToStorage({ maxChurnThreshold: n });
          setMaxChurnThreshold(n);
        }}
        onClose={() => setShowSettings(false)}
      />
      <CommandPalette
        open={showCommandPalette}
        items={commandItems}
        onRun={runCommand}
        onClose={() => setShowCommandPalette(false)}
      />
    </>
  );
}
