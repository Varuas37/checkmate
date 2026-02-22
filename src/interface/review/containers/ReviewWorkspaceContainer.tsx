import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AppFrame,
  Badge,
  Button,
  Card,
  CardBody,
} from "../../../design-system/index.ts";
import {
  clearApiKeyFromStorage,
  initializeAgentTracking,
  installCmCliInPath,
  APP_NAME,
  DEFAULT_AI_ANALYSIS_CONFIG,
  openProjectInNewWindow,
  readRepositoryBranch,
  readRepositoryBranches,
  readRepositoryCommits,
  readCmCliStatus,
  readLaunchRequestFromRuntime,
  readAiAnalysisConfigFromStorage,
  readAndSyncAppSettingsFile,
  readApiKeyFromStorage,
  readCliAgentsSettingsFromStorage,
  readProjectStandardsPathFromStorage,
  readRecentProjectsFromStorage,
  readReviewerProfileFromStorage,
  recordRecentProjectInStorage,
  projectLabelFromPath,
  selectRepositoryFolder,
  writeAiAnalysisConfigToStorage,
  writeApiKeyToStorage,
  writeAppSettingsFile,
  writeCliAgentsSettingsToStorage,
  writeProjectStandardsPathToStorage,
  writeReviewerProfileToStorage,
  type CmCliInstallResult,
  type CmCliStatus,
  type CliAgentsSettings,
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

function fileNameFromPath(path: string): string {
  const normalized = path.trim();
  if (normalized.length === 0) {
    return "file";
  }

  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? normalized;
}

function toLowerIncludes(value: string, query: string): boolean {
  return value.toLowerCase().includes(query.toLowerCase());
}

function isMacOperatingSystem(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

export function ReviewWorkspaceContainer() {
  const { state, actions } = useReviewWorkspace();
  const launchRequestFromLocation = useMemo(resolveLaunchRequestFromLocation, []);
  const [launchRequestFromRuntime, setLaunchRequestFromRuntime] = useState<{
    readonly repositoryPath: string;
    readonly commitSha: string;
  } | null>(null);
  const [isLaunchRequestResolved, setIsLaunchRequestResolved] = useState(
    launchRequestFromLocation !== null,
  );
  const savedReviewerProfile = useMemo(() => readReviewerProfileFromStorage(), []);
  const [cmCliStatus, setCmCliStatus] = useState<CmCliStatus | null>(null);

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
  const [projectStandardsPath, setProjectStandardsPath] = useState(() => {
    const defaultRepositoryPath =
      launchRequestFromLocation?.repositoryPath ??
      readRecentProjectsFromStorage()[0]?.repositoryPath ??
      DEFAULT_LOAD_REQUEST.repositoryPath;
    return readProjectStandardsPathFromStorage(defaultRepositoryPath) ?? "";
  });
  const [cliAgentsSettings, setCliAgentsSettings] = useState<CliAgentsSettings>(
    () => readCliAgentsSettingsFromStorage(),
  );
  const [activeBranch, setActiveBranch] = useState<string | null>(null);
  const [sidebarFocus, setSidebarFocus] = useState<{
    readonly label: string;
    readonly fileIds: readonly string[];
  } | null>(null);
  const [isSequenceExplorerOpen, setIsSequenceExplorerOpen] = useState(false);
  const [sequenceExplorerTabFileIds, setSequenceExplorerTabFileIds] = useState<readonly string[]>([]);
  const [sequenceExplorerActiveFileId, setSequenceExplorerActiveFileId] = useState<string | null>(null);
  const [showProjectSwitcher, setShowProjectSwitcher] = useState(false);
  const [showBranchSwitcher, setShowBranchSwitcher] = useState(false);
  const [projectSwitcherQuery, setProjectSwitcherQuery] = useState("");
  const [branchSwitcherQuery, setBranchSwitcherQuery] = useState("");
  const [availableBranches, setAvailableBranches] = useState<readonly string[]>([]);
  const [isBranchListLoading, setIsBranchListLoading] = useState(false);
  const [branchListError, setBranchListError] = useState<string | null>(null);
  const [branchListRefreshKey, setBranchListRefreshKey] = useState(0);
  const projectSwitcherRef = useRef<HTMLDivElement | null>(null);
  const branchSwitcherRef = useRef<HTMLDivElement | null>(null);
  const launchRequest = launchRequestFromLocation ?? launchRequestFromRuntime;

  // On mount: read settings.json via Tauri and sync values into localStorage + React state.
  // Falls back silently — existing localStorage values are the initial state either way.
  useEffect(() => {
    void readAndSyncAppSettingsFile()
      .then((synced) => {
        if (synced.apiKey !== undefined) {
          setStoredApiKey(synced.apiKey);
        }

        if (synced.maxChurnThreshold !== undefined) {
          setMaxChurnThreshold(synced.maxChurnThreshold);
        }

        if (synced.cliAgents !== undefined) {
          setCliAgentsSettings(synced.cliAgents);
        }
      })
      .catch(() => {
        // Non-critical — ignore read failures.
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (launchRequestFromLocation) {
      setIsLaunchRequestResolved(true);
      return;
    }

    let cancelled = false;
    void readLaunchRequestFromRuntime()
      .then((request) => {
        if (cancelled) {
          return;
        }

        setLaunchRequestFromRuntime(request);
        setIsLaunchRequestResolved(true);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setIsLaunchRequestResolved(true);
      });

    return () => {
      cancelled = true;
    };
  }, [launchRequestFromLocation]);

  useEffect(() => {
    if (!launchRequestFromRuntime) {
      return;
    }

    setStartupRepositoryPath(launchRequestFromRuntime.repositoryPath);
    setStartupCommitSha(launchRequestFromRuntime.commitSha);
    setStartupMessage(null);
  }, [launchRequestFromRuntime]);

  useEffect(() => {
    let cancelled = false;
    void readCmCliStatus()
      .then((status) => {
        if (cancelled) {
          return;
        }

        setCmCliStatus(status);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setCmCliStatus(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

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

  useEffect(() => {
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (showProjectSwitcher) {
        const projectNode = projectSwitcherRef.current;
        if (projectNode && !projectNode.contains(target)) {
          setShowProjectSwitcher(false);
        }
      }

      if (showBranchSwitcher) {
        const branchNode = branchSwitcherRef.current;
        if (branchNode && !branchNode.contains(target)) {
          setShowBranchSwitcher(false);
        }
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      setShowProjectSwitcher(false);
      setShowBranchSwitcher(false);
    };

    window.addEventListener("pointerdown", closeOnOutsidePointerDown);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [showBranchSwitcher, showProjectSwitcher]);

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

  const filesById = useMemo(() => {
    return new Map(state.allFiles.map((file) => [file.id, file] as const));
  }, [state.allFiles]);

  const sequenceExplorerTabs = useMemo(() => {
    return sequenceExplorerTabFileIds
      .map((fileId) => filesById.get(fileId))
      .filter((file): file is NonNullable<typeof file> => file !== undefined);
  }, [filesById, sequenceExplorerTabFileIds]);

  const resolvedSequenceExplorerActiveFileId = useMemo(() => {
    if (sequenceExplorerActiveFileId && filesById.has(sequenceExplorerActiveFileId)) {
      return sequenceExplorerActiveFileId;
    }

    return sequenceExplorerTabs[0]?.id ?? null;
  }, [filesById, sequenceExplorerActiveFileId, sequenceExplorerTabs]);

  useEffect(() => {
    const validIds = new Set(state.allFiles.map((file) => file.id));

    setSequenceExplorerTabFileIds((currentTabs) => {
      const nextTabs = currentTabs.filter((fileId) => validIds.has(fileId));
      return nextTabs.length === currentTabs.length ? currentTabs : nextTabs;
    });

    setSequenceExplorerActiveFileId((currentActiveFileId) => {
      if (currentActiveFileId && validIds.has(currentActiveFileId)) {
        return currentActiveFileId;
      }

      return null;
    });
  }, [state.allFiles]);

  useEffect(() => {
    if (
      !isSequenceExplorerOpen ||
      activeTab !== "overview" ||
      !resolvedSequenceExplorerActiveFileId ||
      state.activeFileId === resolvedSequenceExplorerActiveFileId
    ) {
      return;
    }

    actions.selectFile(resolvedSequenceExplorerActiveFileId);
  }, [
    actions,
    activeTab,
    isSequenceExplorerOpen,
    resolvedSequenceExplorerActiveFileId,
    state.activeFileId,
  ]);

  const openSequenceExplorer = useCallback(() => {
    setIsSequenceExplorerOpen(true);
    setActiveTab("overview");

    setSequenceExplorerTabFileIds((currentTabs) => {
      if (currentTabs.length > 0) {
        return currentTabs;
      }

      const initialFileId = state.activeFileId ?? state.allFiles[0]?.id ?? null;
      if (!initialFileId) {
        return currentTabs;
      }

      setSequenceExplorerActiveFileId(initialFileId);
      actions.selectFile(initialFileId);
      return [initialFileId];
    });
  }, [actions, state.activeFileId, state.allFiles]);

  const closeSequenceExplorer = useCallback(() => {
    setIsSequenceExplorerOpen(false);
  }, []);

  const openSequenceFilesInExplorer = useCallback(
    (fileIds: readonly string[]) => {
      const uniqueFileIds = [...new Set(fileIds.filter((fileId) => filesById.has(fileId)))];
      if (uniqueFileIds.length === 0) {
        return;
      }

      setIsSequenceExplorerOpen(true);
      setActiveTab("overview");

      setSequenceExplorerTabFileIds((currentTabs) => {
        const nextTabs = [...currentTabs];
        uniqueFileIds.forEach((fileId) => {
          if (!nextTabs.includes(fileId)) {
            nextTabs.push(fileId);
          }
        });
        return nextTabs;
      });

      const nextActiveFileId = uniqueFileIds[0] ?? null;
      setSequenceExplorerActiveFileId(nextActiveFileId);
      actions.selectFile(nextActiveFileId);
    },
    [actions, filesById],
  );

  const selectSequenceExplorerTab = useCallback(
    (fileId: string) => {
      if (!filesById.has(fileId)) {
        return;
      }

      setSequenceExplorerActiveFileId(fileId);
      actions.selectFile(fileId);
    },
    [actions, filesById],
  );

  const closeSequenceExplorerTab = useCallback(
    (fileId: string) => {
      const currentTabIndex = sequenceExplorerTabFileIds.indexOf(fileId);
      if (currentTabIndex < 0) {
        return;
      }

      const nextTabs = sequenceExplorerTabFileIds.filter((tabFileId) => tabFileId !== fileId);
      setSequenceExplorerTabFileIds(nextTabs);

      if (nextTabs.length === 0) {
        setSequenceExplorerActiveFileId(null);
        return;
      }

      const shouldResolveNextActive =
        sequenceExplorerActiveFileId === null || sequenceExplorerActiveFileId === fileId;

      if (!shouldResolveNextActive) {
        return;
      }

      const nextIndex = Math.max(0, currentTabIndex - 1);
      const nextActiveFileId = nextTabs[nextIndex] ?? nextTabs[0] ?? null;

      setSequenceExplorerActiveFileId(nextActiveFileId);
      if (nextActiveFileId) {
        actions.selectFile(nextActiveFileId);
      }
    },
    [actions, sequenceExplorerActiveFileId, sequenceExplorerTabFileIds],
  );

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
    const configured = readProjectStandardsPathFromStorage(activeRepositoryPath) ?? "";
    setProjectStandardsPath(configured);
  }, [activeRepositoryPath]);

  const activeProjectName = useMemo(() => {
    return projectLabelFromPath(activeRepositoryPath) || APP_NAME;
  }, [activeRepositoryPath]);

  const activeBranchLabel = activeBranch ?? "HEAD";
  const activeWindowTitle = activeBranch
    ? `${activeProjectName} · ${activeBranch}`
    : activeProjectName;

  const projectSwitcherEntries = useMemo(() => {
    const seen = new Set<string>();
    const query = projectSwitcherQuery.trim().toLowerCase();

    return [activeRepositoryPath, ...recentProjects.map((entry) => entry.repositoryPath)]
      .map((path) => normalizeInputValue(path))
      .filter((path) => {
        if (path.length === 0 || seen.has(path)) {
          return false;
        }

        seen.add(path);
        return true;
      })
      .map((repositoryPath) => ({
        repositoryPath,
        label: projectLabelFromPath(repositoryPath) || repositoryPath,
      }))
      .filter((entry) => {
        if (query.length === 0) {
          return true;
        }

        return (
          toLowerIncludes(entry.label, query) ||
          toLowerIncludes(entry.repositoryPath, query)
        );
      });
  }, [activeRepositoryPath, projectSwitcherQuery, recentProjects]);

  const filteredBranches = useMemo(() => {
    const query = branchSwitcherQuery.trim().toLowerCase();
    const branchSource =
      availableBranches.length > 0
        ? availableBranches
        : activeBranch
        ? [activeBranch]
        : [];

    if (query.length === 0) {
      return branchSource;
    }

    return branchSource.filter((branch) => toLowerIncludes(branch, query));
  }, [activeBranch, availableBranches, branchSwitcherQuery]);

  const firstProjectSwitcherEntry = projectSwitcherEntries[0] ?? null;
  const firstFilteredBranch = filteredBranches[0] ?? null;

  useEffect(() => {
    const normalizedRepositoryPath = normalizeInputValue(activeRepositoryPath);

    if (normalizedRepositoryPath.length === 0) {
      setActiveBranch(null);
      return;
    }

    let cancelled = false;

    void readRepositoryBranch(normalizedRepositoryPath)
      .then((branchName) => {
        if (cancelled) {
          return;
        }

        setActiveBranch(branchName);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setActiveBranch(null);
      });

    return () => {
      cancelled = true;
    };
  }, [activeRepositoryPath, state.loadStatus]);

  useEffect(() => {
    if (!showBranchSwitcher) {
      return;
    }

    const normalizedRepositoryPath = normalizeInputValue(activeRepositoryPath);
    if (normalizedRepositoryPath.length === 0) {
      setAvailableBranches([]);
      setBranchListError("Repository path is not available.");
      return;
    }

    let cancelled = false;
    setIsBranchListLoading(true);
    setBranchListError(null);

    void readRepositoryBranches(normalizedRepositoryPath)
      .then((branches) => {
        if (cancelled) {
          return;
        }

        setAvailableBranches(branches);
        setIsBranchListLoading(false);
        if (branches.length === 0) {
          setBranchListError("No local branches found.");
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Failed to load local branches.";
        setAvailableBranches([]);
        setBranchListError(message);
        setIsBranchListLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeRepositoryPath, branchListRefreshKey, showBranchSwitcher]);

  useEffect(() => {
    if (!showProjectSwitcher) {
      setProjectSwitcherQuery("");
    }
  }, [showProjectSwitcher]);

  useEffect(() => {
    if (!showBranchSwitcher) {
      setBranchSwitcherQuery("");
    }
  }, [showBranchSwitcher]);

  useEffect(() => {
    document.title = activeWindowTitle;

    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      return;
    }

    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().setTitle(activeWindowTitle),
      )
      .catch(() => {
        // Ignore title update failures when runtime window APIs are unavailable.
      });
  }, [activeWindowTitle]);

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
      setShowProjectSwitcher(false);
      setShowBranchSwitcher(false);
      setIsSequenceExplorerOpen(false);
      setSequenceExplorerTabFileIds([]);
      setSequenceExplorerActiveFileId(null);
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

  const selectBranchFromSwitcher = useCallback(
    (branchName: string) => {
      const normalizedBranch = normalizeInputValue(branchName);
      if (normalizedBranch.length === 0) {
        return;
      }

      setActiveBranch(normalizedBranch);
      setShowBranchSwitcher(false);
      setBranchSwitcherQuery("");
      setCommitShaInput(normalizedBranch);
      triggerCommitReload(normalizedBranch);
    },
    [triggerCommitReload],
  );

  const openProjectFromSwitcherInCurrentWindow = useCallback(
    (repositoryPath: string) => {
      const normalizedPath = normalizeInputValue(repositoryPath);
      if (normalizedPath.length === 0) {
        return;
      }

      setShowProjectSwitcher(false);
      setProjectSwitcherQuery("");
      setCommitShaInput(DEFAULT_LOAD_REQUEST.commitSha);
      setStartupRepositoryPath(normalizedPath);
      setStartupCommitSha(DEFAULT_LOAD_REQUEST.commitSha);
      setStartupMessage(null);
      recordRecentProject(normalizedPath);
      launchWorkspace(normalizedPath, DEFAULT_LOAD_REQUEST.commitSha);
    },
    [launchWorkspace, recordRecentProject],
  );

  const openProjectFromSwitcherInNewWindow = useCallback(
    async (repositoryPath: string) => {
      const normalizedPath = normalizeInputValue(repositoryPath);
      if (normalizedPath.length === 0) {
        return;
      }

      setShowProjectSwitcher(false);
      setProjectSwitcherQuery("");
      recordRecentProject(normalizedPath);
      await openProjectInNewWindow({
        repositoryPath: normalizedPath,
        commitSha: DEFAULT_LOAD_REQUEST.commitSha,
      });
    },
    [recordRecentProject],
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

    setShowSettings(false);
    openProjectFromSwitcherInCurrentWindow(selectedPath);
  }, [openProjectFromSwitcherInCurrentWindow]);

  const openProjectInNewWindowWithPicker = useCallback(async () => {
    const selectedPath = await selectRepositoryFolder();
    if (!selectedPath) {
      return;
    }

    await openProjectFromSwitcherInNewWindow(selectedPath);
    setShowSettings(false);
  }, [openProjectFromSwitcherInNewWindow]);

  const openRecentProjectInCurrentWindow = useCallback(
    (repositoryPath: string) => {
      setShowSettings(false);
      openProjectFromSwitcherInCurrentWindow(repositoryPath);
    },
    [openProjectFromSwitcherInCurrentWindow],
  );

  const openRecentProjectInNewWindow = useCallback(
    async (repositoryPath: string) => {
      await openProjectFromSwitcherInNewWindow(repositoryPath);
      setShowSettings(false);
    },
    [openProjectFromSwitcherInNewWindow],
  );

  const refreshCmCliStatus = useCallback(async () => {
    const status = await readCmCliStatus();
    setCmCliStatus(status);
  }, []);

  const installCmCliCommand = useCallback(async (): Promise<CmCliInstallResult> => {
    const installResult = await installCmCliInPath();
    try {
      const latestStatus = await readCmCliStatus();
      setCmCliStatus(
        latestStatus ?? {
          installed: true,
          installPath: installResult.installPath,
          onPath: installResult.onPath,
        },
      );
    } catch {
      setCmCliStatus({
        installed: true,
        installPath: installResult.installPath,
        onPath: installResult.onPath,
      });
    }
    return installResult;
  }, []);

  const initializeTrackingFromSettings = useCallback(async (repositoryPath: string) => {
    const normalizedRepositoryPath = normalizeInputValue(repositoryPath);
    if (normalizedRepositoryPath.length === 0) {
      throw new Error("Open a project first to initialize tracking files.");
    }

    return initializeAgentTracking(normalizedRepositoryPath);
  }, []);

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
    if (!isLaunchRequestResolved || hasAttemptedAutoStart || state.loadStatus !== "idle" || state.commit) {
      return;
    }

    setHasAttemptedAutoStart(true);

    const launchRepositoryPath = normalizeInputValue(launchRequest?.repositoryPath ?? "");
    const launchCommitSha =
      normalizeInputValue(launchRequest?.commitSha ?? "") || DEFAULT_LOAD_REQUEST.commitSha;

    if (launchRepositoryPath.length > 0) {
      setStartupRepositoryPath(launchRepositoryPath);
      setStartupCommitSha(launchCommitSha);
      setStartupMessage(null);
      recordRecentProject(launchRepositoryPath);
      launchWorkspace(launchRepositoryPath, launchCommitSha);
      return;
    }

    if (!shouldAutoStart) {
      return;
    }

    startReviewFromHome();
  }, [
    hasAttemptedAutoStart,
    isLaunchRequestResolved,
    launchRequest?.commitSha,
    launchRequest?.repositoryPath,
    launchWorkspace,
    recordRecentProject,
    shouldAutoStart,
    startReviewFromHome,
    state.commit,
    state.loadStatus,
  ]);

  useEffect(() => {
    if (state.loadStatus !== "loaded") {
      return;
    }

    const normalizedRepositoryPath = normalizeInputValue(activeRepositoryPath);
    if (normalizedRepositoryPath.length === 0) {
      return;
    }

    let cancelled = false;
    let isChecking = false;

    const checkForNewCommits = async () => {
      if (isChecking) {
        return;
      }

      isChecking = true;
      try {
        const latestCommit = await readRepositoryCommits(normalizedRepositoryPath, 1);
        if (cancelled) {
          return;
        }

        const latestHash = latestCommit[0]?.hash ?? null;
        const knownHash = state.repositoryCommits[0]?.hash ?? null;

        if (latestHash && latestHash !== knownHash) {
          await actions.refreshRepositoryCommits(normalizedRepositoryPath, 120);
        }
      } catch {
        // Ignore transient git polling failures.
      } finally {
        isChecking = false;
      }
    };

    const timerId = window.setInterval(() => {
      void checkForNewCommits();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [
    actions,
    activeRepositoryPath,
    state.loadStatus,
    state.repositoryCommits,
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

  useEffect(() => {
    const handleCloseSequenceExplorerTabShortcut = (event: KeyboardEvent) => {
      const hasCommandModifier = event.metaKey || event.ctrlKey;
      if (!hasCommandModifier || event.shiftKey || event.altKey) {
        return;
      }

      if (event.key.toLowerCase() !== "w") {
        return;
      }

      if (
        !isSequenceExplorerOpen ||
        activeTab !== "overview" ||
        !resolvedSequenceExplorerActiveFileId
      ) {
        return;
      }

      event.preventDefault();
      closeSequenceExplorerTab(resolvedSequenceExplorerActiveFileId);
    };

    window.addEventListener("keydown", handleCloseSequenceExplorerTabShortcut);
    return () => {
      window.removeEventListener("keydown", handleCloseSequenceExplorerTabShortcut);
    };
  }, [
    activeTab,
    closeSequenceExplorerTab,
    isSequenceExplorerOpen,
    resolvedSequenceExplorerActiveFileId,
  ]);

  const handleTabChange = useCallback((tabId: ReviewTabId) => {
    setActiveTab(tabId);

    if (tabId !== "overview") {
      setSidebarFocus(null);
      setIsSequenceExplorerOpen(false);
    }
  }, []);

  const runCommand = useCallback(
    async (item: CommandPaletteItem) => {
      const action = commandActionById.get(item.id);
      if (!action) {
        return;
      }

      if (action.kind === "tab") {
        handleTabChange(action.tabId);
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
    [actions, commandActionById, handleTabChange, openProjectInNewWindowWithPicker, triggerCommitReload],
  );

  const sequenceExplorerActiveFile = useMemo(() => {
    if (!resolvedSequenceExplorerActiveFileId) {
      return null;
    }

    return filesById.get(resolvedSequenceExplorerActiveFileId) ?? null;
  }, [filesById, resolvedSequenceExplorerActiveFileId]);

  const isSequenceExplorerDiffReady =
    sequenceExplorerActiveFile !== null &&
    state.activeFile !== null &&
    state.activeFileId === sequenceExplorerActiveFile.id;

  const sequenceExpandedSidePanel = useMemo(() => {
    if (sequenceExplorerTabs.length === 0) {
      return (
        <div className="flex h-full items-center justify-center px-4 text-sm text-muted">
          Click any sequence step to open related files here.
        </div>
      );
    }

    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-border/60 px-2 py-1.5">
          <div className="flex items-center gap-1 overflow-x-auto">
            {sequenceExplorerTabs.map((file) => {
              const isActive = file.id === resolvedSequenceExplorerActiveFileId;
              return (
                <div
                  key={file.id}
                  className={[
                    "inline-flex max-w-[20rem] items-center gap-1.5 rounded-md border px-1 py-1",
                    isActive
                      ? "border-accent/55 bg-accent/15"
                      : "border-border/70 bg-canvas/80 hover:bg-elevated",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    onClick={() => selectSequenceExplorerTab(file.id)}
                    className={[
                      "min-w-0 truncate px-1 text-left font-mono text-xs transition-colors",
                      isActive ? "text-accent" : "text-muted hover:text-text",
                    ].join(" ")}
                    title={file.path}
                  >
                    {fileNameFromPath(file.path)}
                  </button>
                  <button
                    type="button"
                    onClick={() => closeSequenceExplorerTab(file.id)}
                    className="shrink-0 rounded-sm px-1 text-[10px] text-muted transition-colors hover:bg-danger/15 hover:text-danger"
                    aria-label={`Close ${file.path}`}
                    title={`Close ${file.path}`}
                  >
                    x
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1">
          {!sequenceExplorerActiveFile && (
            <div className="flex h-full items-center justify-center px-4 text-sm text-muted">
              Select a file tab to inspect its diff.
            </div>
          )}

          {sequenceExplorerActiveFile && !isSequenceExplorerDiffReady && (
            <div className="flex h-full items-center justify-center px-4 text-sm text-muted">
              Loading {sequenceExplorerActiveFile.path}...
            </div>
          )}

          {sequenceExplorerActiveFile && isSequenceExplorerDiffReady && (
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
          )}
        </div>
      </div>
    );
  }, [
    actions,
    closeSequenceExplorerTab,
    isSequenceExplorerDiffReady,
    resolvedSequenceExplorerActiveFileId,
    reviewerAuthorId,
    selectSequenceExplorerTab,
    sequenceExplorerActiveFile,
    sequenceExplorerTabs,
    showInlineComments,
    state.activeFile,
    state.activeFileHunks,
    state.activeFileVersions,
    state.activeFileVersionsError,
    state.activeFileVersionsStatus,
    state.diffOrientation,
    state.diffViewMode,
    state.threadModels,
  ]);

  useEffect(() => {
    if (activeTab === "overview") {
      setIsSidebarCollapsed(true);
      return;
    }

    setIsSidebarCollapsed(false);
  }, [activeTab]);

  useEffect(() => {
    if (
      activeTab !== "standards" ||
      state.loadStatus !== "loaded" ||
      !state.commit ||
      state.standardsAnalysisStatus !== "idle"
    ) {
      return;
    }

    actions.refreshStandardsAnalysis();
  }, [
    actions,
    activeTab,
    state.commit,
    state.loadStatus,
    state.standardsAnalysisStatus,
  ]);

  const windowControlsInsetClass = isMacOperatingSystem() ? "w-[6.75rem]" : "w-3";

  const projectAndBranchControls = (
    <div className="flex items-center gap-2 font-mono text-[11px]">
      <div ref={projectSwitcherRef} className="relative">
        <button
          type="button"
          onClick={() => {
            setShowProjectSwitcher((current) => !current);
            setShowBranchSwitcher(false);
          }}
          className="inline-flex h-7 items-center gap-1.5 rounded-sm px-1.5 text-text/90 transition-colors hover:bg-elevated/45 hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/65"
          title={activeRepositoryPath}
          aria-label="Open project switcher"
        >
          <span className="max-w-[16rem] truncate">{activeProjectName}</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 7.5 10 12.5 15 7.5" />
          </svg>
        </button>

        {showProjectSwitcher && (
          <div className="absolute left-0 top-[calc(100%+0.45rem)] z-50 w-[30rem] max-w-[88vw] overflow-hidden rounded-lg border border-border/80 bg-surface shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
            <div className="border-b border-border/70 p-2">
              <p className="mb-1.5 text-[11px] text-muted">
                Enter reuses this window, Cmd/Ctrl+Enter opens a new one.
              </p>
              <input
                value={projectSwitcherQuery}
                onChange={(event) => setProjectSwitcherQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || !firstProjectSwitcherEntry) {
                    return;
                  }

                  event.preventDefault();
                  if (event.metaKey || event.ctrlKey) {
                    void openProjectFromSwitcherInNewWindow(
                      firstProjectSwitcherEntry.repositoryPath,
                    );
                    return;
                  }

                  openProjectFromSwitcherInCurrentWindow(
                    firstProjectSwitcherEntry.repositoryPath,
                  );
                }}
                placeholder="Select project..."
                className="h-9 w-full rounded-md border border-border/60 bg-canvas px-2.5 text-sm text-text outline-none transition-colors placeholder:text-muted focus:border-accent/60"
                autoFocus
              />
            </div>

            <div className="max-h-[16rem] overflow-y-auto">
              {projectSwitcherEntries.length === 0 && (
                <p className="px-3 py-3 text-sm text-muted">
                  No matching projects.
                </p>
              )}

              {projectSwitcherEntries.map((entry) => {
                const isActiveProject = entry.repositoryPath === activeRepositoryPath;
                return (
                  <button
                    key={entry.repositoryPath}
                    type="button"
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey) {
                        void openProjectFromSwitcherInNewWindow(entry.repositoryPath);
                        return;
                      }

                      openProjectFromSwitcherInCurrentWindow(entry.repositoryPath);
                    }}
                    className={[
                      "w-full border-b border-border/40 px-3 py-2.5 text-left transition-colors last:border-b-0",
                      isActiveProject ? "bg-accent/10" : "hover:bg-elevated/60",
                    ].join(" ")}
                    title={entry.repositoryPath}
                  >
                    <p className="truncate text-sm text-text">{entry.label}</p>
                    <p className="truncate text-xs text-muted">{entry.repositoryPath}</p>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-end gap-1.5 border-t border-border/70 p-2">
              <Button
                size="sm"
                variant="secondary"
                className="h-7 px-2"
                onClick={() => {
                  void openProjectInCurrentWindow();
                }}
              >
                Open Local Folder
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={() => {
                  void openProjectInNewWindowWithPicker();
                }}
              >
                Open in New Window
              </Button>
            </div>
          </div>
        )}
      </div>

      <div ref={branchSwitcherRef} className="relative">
        <button
          type="button"
          onClick={() => {
            setShowBranchSwitcher((current) => !current);
            setShowProjectSwitcher(false);
          }}
          className="inline-flex h-7 items-center gap-1.5 rounded-sm px-1.5 text-muted transition-colors hover:bg-elevated/45 hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/65"
          aria-label="Open branch switcher"
        >
          <span className="truncate">{activeBranchLabel}</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 7.5 10 12.5 15 7.5" />
          </svg>
        </button>

        {showBranchSwitcher && (
          <div className="absolute left-0 top-[calc(100%+0.45rem)] z-50 w-[26rem] max-w-[86vw] overflow-hidden rounded-lg border border-border/80 bg-surface shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
            <div className="border-b border-border/70 p-2">
              <input
                value={branchSwitcherQuery}
                onChange={(event) => setBranchSwitcherQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || !firstFilteredBranch) {
                    return;
                  }

                  event.preventDefault();
                  selectBranchFromSwitcher(firstFilteredBranch);
                }}
                placeholder="Select local branch..."
                className="h-9 w-full rounded-md border border-border/60 bg-canvas px-2.5 text-sm text-text outline-none transition-colors placeholder:text-muted focus:border-accent/60"
                autoFocus
              />
            </div>

            <div className="max-h-[16rem] overflow-y-auto">
              {isBranchListLoading && (
                <p className="px-3 py-3 text-sm text-muted">
                  Loading local branches...
                </p>
              )}

              {!isBranchListLoading && branchListError && (
                <p className="px-3 py-3 text-sm text-danger">
                  {branchListError}
                </p>
              )}

              {!isBranchListLoading &&
                !branchListError &&
                filteredBranches.map((branch) => {
                  const isCurrent = branch === activeBranch;
                  return (
                    <button
                      key={branch}
                      type="button"
                      onClick={() => selectBranchFromSwitcher(branch)}
                      className={[
                        "flex w-full items-center justify-between border-b border-border/40 px-3 py-2 text-left transition-colors last:border-b-0",
                        isCurrent ? "bg-accent/10" : "hover:bg-elevated/60",
                      ].join(" ")}
                    >
                      <span className="truncate text-sm text-text">{branch}</span>
                      {isCurrent && (
                        <span className="rounded-sm border border-accent/50 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-accent">
                          Current
                        </span>
                      )}
                    </button>
                  );
                })}

              {!isBranchListLoading &&
                !branchListError &&
                filteredBranches.length === 0 && (
                  <p className="px-3 py-3 text-sm text-muted">
                    No matching branches.
                  </p>
                )}
            </div>

            <div className="flex items-center justify-end border-t border-border/70 p-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={() => {
                  setBranchListError(null);
                  setBranchListRefreshKey((value) => value + 1);
                }}
              >
                Refresh
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const header = (
    <header className="bg-surface/85 backdrop-blur-sm">
      <div className="relative flex h-11 items-center bg-transparent pr-3">
        <div
          className={`${windowControlsInsetClass} h-full shrink-0`}
          data-tauri-drag-region
        />

        <div className="flex min-w-0 items-center pl-2">{projectAndBranchControls}</div>

        <div className="h-full min-w-0 flex-1" data-tauri-drag-region />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {state.commit && <Badge tone="accent">{state.commit.shortSha}</Badge>}
            <Badge tone="positive">+{totalAdditions}</Badge>
            <Badge tone="danger">-{totalDeletions}</Badge>
          </div>

          <p className="truncate text-sm font-semibold tracking-tight text-text">
            {state.commit ? state.commit.title : "Code Review Workspace"}
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
            <p className="whitespace-pre-wrap break-words text-muted">
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
            className="h-9 w-9 px-0"
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
          sequenceViewMode={isSequenceExplorerOpen ? "expanded" : "compact"}
          onRefreshAiAnalysis={actions.refreshAiAnalysis}
          onRetrySequenceGeneration={actions.retrySequenceGeneration}
          onOpenSequenceExplorer={openSequenceExplorer}
          onCloseSequenceExplorer={closeSequenceExplorer}
          onOpenSequenceFilesInExplorer={openSequenceFilesInExplorer}
          sequenceExpandedSidePanel={sequenceExpandedSidePanel}
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
        {(state.standardsAnalysisStatus === "analysing" ||
          (state.standardsAnalysisStatus === "idle" && state.standardsChecks.length === 0)) && (
          <Card>
            <CardBody className="flex items-center justify-between gap-3 py-6">
              <div>
                <p className="font-display text-sm font-semibold text-text">Generating standards insights...</p>
                <p className="text-sm text-muted">
                  Checkmate is evaluating this commit against your configured coding standards.
                </p>
              </div>
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent/40 border-t-accent" />
            </CardBody>
          </Card>
        )}
        {state.standardsAnalysisStatus === "error" && (
          <Card>
            <CardBody className="space-y-3 py-5">
              <p className="text-sm text-danger">
                {state.standardsAnalysisError ?? "Unable to generate standards insights."}
              </p>
              <Button size="sm" variant="secondary" onClick={actions.refreshStandardsAnalysis}>
                Retry Standards Analysis
              </Button>
            </CardBody>
          </Card>
        )}
        {state.standardsAnalysisStatus !== "analysing" && state.standardsAnalysisStatus !== "idle" && (
          <StandardsPanel checks={state.standardsChecks} counts={state.standardsCounts} />
        )}
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
    state.standardsAnalysisStatus,
    state.standardsAnalysisError,
    state.standardsChecks,
    state.standardsCounts,
    state.threadModels,
    state.architectureClusters,
    state.repositoryCommits,
    showInlineComments,
    reviewerAuthorId,
    isSequenceExplorerOpen,
    openSequenceExplorer,
    closeSequenceExplorer,
    openSequenceFilesInExplorer,
    sequenceExpandedSidePanel,
    commitShaInput,
    activeRepositoryPath,
    triggerCommitReload,
    isSidebarCollapsed,
    actions.refreshStandardsAnalysis,
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
          initialProjectStandardsPath={projectStandardsPath}
          initialCliAgents={cliAgentsSettings}
          activeRepositoryPath={activeRepositoryPath}
          recentProjects={recentProjects}
          cmCliStatus={cmCliStatus}
          onOpenProjectInCurrentWindow={openProjectInCurrentWindow}
          onOpenProjectInNewWindow={openProjectInNewWindowWithPicker}
          onOpenRecentProjectInCurrentWindow={openRecentProjectInCurrentWindow}
          onOpenRecentProjectInNewWindow={openRecentProjectInNewWindow}
          onInitializeTracking={initializeTrackingFromSettings}
          onInstallCmCli={installCmCliCommand}
          onRefreshCmCliStatus={refreshCmCliStatus}
          onSave={(key) => {
            const trimmed = key.trim();
            if (trimmed.length > 0) {
              writeApiKeyToStorage(trimmed);
            } else {
              clearApiKeyFromStorage();
            }
            setStoredApiKey(trimmed);
            void writeAppSettingsFile({ apiKey: trimmed });
            setShowSettings(false);
          }}
          onSaveMaxChurn={(n) => {
            writeAiAnalysisConfigToStorage({ maxChurnThreshold: n });
            setMaxChurnThreshold(n);
            void writeAppSettingsFile({ maxChurnThreshold: n });
          }}
          onSaveProjectStandardsPath={(standardsPath) => {
            writeProjectStandardsPathToStorage(activeRepositoryPath, standardsPath);
            setProjectStandardsPath(standardsPath);
          }}
          onSaveCliAgents={(settings: CliAgentsSettings) => {
            writeCliAgentsSettingsToStorage(settings);
            setCliAgentsSettings(settings);
            void writeAppSettingsFile({ cliAgents: settings });
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
        initialProjectStandardsPath={projectStandardsPath}
        initialCliAgents={cliAgentsSettings}
        activeRepositoryPath={activeRepositoryPath}
        recentProjects={recentProjects}
        cmCliStatus={cmCliStatus}
        onOpenProjectInCurrentWindow={openProjectInCurrentWindow}
        onOpenProjectInNewWindow={openProjectInNewWindowWithPicker}
        onOpenRecentProjectInCurrentWindow={openRecentProjectInCurrentWindow}
        onOpenRecentProjectInNewWindow={openRecentProjectInNewWindow}
        onInitializeTracking={initializeTrackingFromSettings}
        onInstallCmCli={installCmCliCommand}
        onRefreshCmCliStatus={refreshCmCliStatus}
        onSave={(key) => {
          const trimmed = key.trim();
          if (trimmed.length > 0) {
            writeApiKeyToStorage(trimmed);
          } else {
            clearApiKeyFromStorage();
          }
          setStoredApiKey(trimmed);
          void writeAppSettingsFile({ apiKey: trimmed });
          setShowSettings(false);
        }}
        onSaveMaxChurn={(n) => {
          writeAiAnalysisConfigToStorage({ maxChurnThreshold: n });
          setMaxChurnThreshold(n);
          void writeAppSettingsFile({ maxChurnThreshold: n });
        }}
        onSaveProjectStandardsPath={(standardsPath) => {
          writeProjectStandardsPathToStorage(activeRepositoryPath, standardsPath);
          setProjectStandardsPath(standardsPath);
        }}
        onSaveCliAgents={(settings: CliAgentsSettings) => {
          writeCliAgentsSettingsToStorage(settings);
          setCliAgentsSettings(settings);
          void writeAppSettingsFile({ cliAgents: settings });
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
