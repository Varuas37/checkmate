import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Skeleton from "react-loading-skeleton";

import {
  AppFrame,
  Badge,
  Button,
  Card,
  CardBody,
} from "../../../design-system/index.ts";
import {
  clearApiKeyFromStorage,
  type AgentTrackingRemovalResult,
  type AgentTrackingStatus,
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
  readAgentTrackingStatus,
  readApiKeyFromStorage,
  readCliAgentsSettingsFromStorage,
  readProjectStandardsPathFromStorage,
  readRecentProjectsFromStorage,
  readSystemUserName,
  readReviewerProfileFromStorage,
  recordRecentProjectInStorage,
  removeAgentTracking,
  projectLabelFromPath,
  selectRepositoryFolder,
  testAnthropicApiConnection,
  testCliAgentConnection,
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
  CodeSequenceDiagramPanel,
  CommitPanel,
  CommandPalette,
  type CommandPaletteItem,
  DiffViewer,
  FileSummaryInspector,
  HomeScreen,
  SettingsPanel,
  StandardsPanel,
  SummaryPanel,
  TopTabs,
  UserCommentsModal,
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

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeHunkHeaderText(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

function stripFlowStagePrefix(value: string): string {
  return value
    .replaceAll(/\s+/g, " ")
    .trim()
    .replace(/^(before|after)\b\s*[:\-]?\s*/i, "")
    .trim();
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

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  if (target instanceof HTMLTextAreaElement) {
    return true;
  }

  if (target instanceof HTMLInputElement) {
    const type = target.type.toLowerCase();
    return type !== "checkbox" && type !== "radio" && type !== "button" && type !== "submit";
  }

  return false;
}

function CommentsIcon({ muted }: { readonly muted: boolean }) {
  return (
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
      <rect x="2" y="2" width="16" height="12.5" rx="2.5" />
      <path d="M6.25 14.5v3.5l3.25-3.5" />
      <path d="M5.5 6.5h8.75" />
      <path d="M5.5 9.5h5.75" />
      {muted && <path d="M3.25 3.25l13.5 13.5" />}
    </svg>
  );
}

function SummaryIcon() {
  return (
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
      <path d="M5.5 6.5h9" />
      <path d="M5.5 10h9" />
      <path d="M5.5 13.5h6.5" />
    </svg>
  );
}

function UserCommentsIcon() {
  return (
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
      <path d="M7 6.25a1.75 1.75 0 1 0-3.5 0A1.75 1.75 0 0 0 7 6.25Z" />
      <path d="M16.5 6.25a1.75 1.75 0 1 0-3.5 0A1.75 1.75 0 0 0 16.5 6.25Z" />
      <path d="M11.75 4.75a2.25 2.25 0 1 0-4.5 0 2.25 2.25 0 0 0 4.5 0Z" />
      <path d="M1.75 13.75c0-1.9 1.4-3.25 3.25-3.25 1.85 0 3.25 1.35 3.25 3.25" />
      <path d="M11.75 14c0-2.2-1.7-3.75-3.75-3.75-2.05 0-3.75 1.55-3.75 3.75" />
      <path d="M11.75 13.75c0-1.9 1.4-3.25 3.25-3.25 1.85 0 3.25 1.35 3.25 3.25" />
    </svg>
  );
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

  const [activeTab, setActiveTab] = useState<ReviewTabId>("summary");
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
  const [showUserCommentsModal, setShowUserCommentsModal] = useState(false);
  const [selectedCommentAuthorKey, setSelectedCommentAuthorKey] = useState<string | null>(null);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [storedApiKey, setStoredApiKey] = useState(() => readApiKeyFromStorage() ?? "");
  const [maxChurnThreshold, setMaxChurnThreshold] = useState(
    () => readAiAnalysisConfigFromStorage().maxChurnThreshold,
  );
  const [autoRunOnCommitChange, setAutoRunOnCommitChange] = useState(
    () => readAiAnalysisConfigFromStorage().autoRunOnCommitChange,
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
  const [selectedFeatureFocusId, setSelectedFeatureFocusId] = useState<string | null>(null);
  const [isSequenceExplorerOpen, setIsSequenceExplorerOpen] = useState(true);
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
  const [isCopyingPlan, setIsCopyingPlan] = useState(false);
  const [copyPlanFeedback, setCopyPlanFeedback] = useState<{
    readonly tone: "success" | "error";
    readonly message: string;
  } | null>(null);
  const projectSwitcherRef = useRef<HTMLDivElement | null>(null);
  const branchSwitcherRef = useRef<HTMLDivElement | null>(null);
  const copyPlanFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitFeedHydratedRepositoryRef = useRef<string | null>(null);
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

        if (synced.autoRunOnCommitChange !== undefined) {
          setAutoRunOnCommitChange(synced.autoRunOnCommitChange);
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
    const currentName = normalizeInputValue(reviewerName);
    if (currentName.length > 0) {
      return;
    }

    let cancelled = false;
    void readSystemUserName()
      .then((value) => {
        if (cancelled) {
          return;
        }

        const normalized = normalizeInputValue(value);
        if (normalized.length === 0) {
          return;
        }

        setReviewerName((current) => {
          if (normalizeInputValue(current).length > 0) {
            return current;
          }

          return normalized;
        });
      })
      .catch(() => {
        // Ignore runtime lookup failures.
      });

    return () => {
      cancelled = true;
    };
  }, [reviewerName]);

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
    return () => {
      if (copyPlanFeedbackTimerRef.current !== null) {
        clearTimeout(copyPlanFeedbackTimerRef.current);
      }
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
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }

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
    const handleSelectAllShortcut = (event: KeyboardEvent) => {
      const hasCommandModifier = event.metaKey || event.ctrlKey;
      if (!hasCommandModifier || event.shiftKey || event.altKey || event.key.toLowerCase() !== "a") {
        return;
      }

      const target = event.target;
      if (!isEditableKeyboardTarget(target)) {
        return;
      }

      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        event.preventDefault();
        target.select();
        return;
      }

      if (target instanceof HTMLElement && target.isContentEditable) {
        event.preventDefault();
        const selection = window.getSelection();
        if (!selection) {
          return;
        }
        const range = document.createRange();
        range.selectNodeContents(target);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    };

    window.addEventListener("keydown", handleSelectAllShortcut);
    return () => {
      window.removeEventListener("keydown", handleSelectAllShortcut);
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

  const featureFocusOptions = useMemo(() => {
    const validFileIds = new Set(state.allFiles.map((file) => file.id));
    const optionsByLabel = new Map<
      string,
      {
        readonly id: string;
        readonly label: string;
        readonly fileIds: Set<string>;
        readonly hunkHeadersByFilePath: Map<string, Set<string>>;
      }
    >();

    state.sequencePairs.forEach((pair, index) => {
      const resolvedLabel =
        stripFlowStagePrefix(normalizeInputValue(pair.after.title))
        || stripFlowStagePrefix(normalizeInputValue(pair.before.title))
        || `Feature ${index + 1}`;
      const normalizedLabel = resolvedLabel.toLowerCase();
      const optionId = slugify(resolvedLabel) || `feature-${index + 1}`;
      const fileIds = [...pair.before.fileIds, ...pair.after.fileIds].filter((fileId) =>
        validFileIds.has(fileId),
      );

      if (fileIds.length === 0) {
        return;
      }

      const existing = optionsByLabel.get(normalizedLabel);
      if (!existing) {
        optionsByLabel.set(normalizedLabel, {
          id: optionId,
          label: resolvedLabel,
          fileIds: new Set(fileIds),
          hunkHeadersByFilePath: new Map(),
        });
      } else {
        fileIds.forEach((fileId) => existing.fileIds.add(fileId));
      }

      const target = optionsByLabel.get(normalizedLabel);
      if (!target) {
        return;
      }

      pair.hunkHeadersByFilePath?.forEach((entry) => {
        const filePath = normalizeInputValue(entry.filePath);
        if (filePath.length === 0) {
          return;
        }

        const headers = entry.hunkHeaders
          .map((header) => normalizeHunkHeaderText(header))
          .filter((header) => header.length > 0);
        if (headers.length === 0) {
          return;
        }

        const current = target.hunkHeadersByFilePath.get(filePath) ?? new Set<string>();
        headers.forEach((header) => current.add(header));
        target.hunkHeadersByFilePath.set(filePath, current);
      });
    });

    return [...optionsByLabel.values()].map((option) => {
      return {
        id: option.id,
        label: option.label,
        fileIds: [...option.fileIds],
        hunkHeadersByFilePath: [...option.hunkHeadersByFilePath.entries()].map(
          ([filePath, hunkHeaders]) => ({
            filePath,
            hunkHeaders: [...hunkHeaders],
          }),
        ),
      };
    });
  }, [state.allFiles, state.sequencePairs]);

  useEffect(() => {
    if (!selectedFeatureFocusId) {
      return;
    }

    const hasSelectedFeature = featureFocusOptions.some(
      (option) => option.id === selectedFeatureFocusId,
    );
    if (hasSelectedFeature) {
      return;
    }

    setSelectedFeatureFocusId(null);

    if (sidebarFocus?.label === "Feature Focus") {
      setSidebarFocus(null);
    }
  }, [featureFocusOptions, selectedFeatureFocusId, sidebarFocus]);

  const sidebarFiles = useMemo(() => {
    if (!sidebarFocus) {
      return state.filteredFiles;
    }

    const focusedFileIds = new Set(sidebarFocus.fileIds);
    return state.filteredFiles.filter((file) => focusedFileIds.has(file.id));
  }, [sidebarFocus, state.filteredFiles]);

  const handleFeatureFilterChange = useCallback(
    (featureId: string | null) => {
      if (!featureId) {
        setSelectedFeatureFocusId(null);
        setSidebarFocus(null);
        return;
      }

      const selectedFeature = featureFocusOptions.find((option) => option.id === featureId);
      if (!selectedFeature || selectedFeature.fileIds.length === 0) {
        setSelectedFeatureFocusId(null);
        setSidebarFocus(null);
        return;
      }

      setSelectedFeatureFocusId(selectedFeature.id);
      setHighlightedFileIds(selectedFeature.fileIds);
      setSidebarFocus({
        label: "Feature Focus",
        fileIds: selectedFeature.fileIds,
      });

      if (!state.activeFileId || !selectedFeature.fileIds.includes(state.activeFileId)) {
        actions.selectFile(selectedFeature.fileIds[0] ?? null);
      }
    },
    [actions, featureFocusOptions, state.activeFileId],
  );

  const filesById = useMemo(() => {
    return new Map(state.allFiles.map((file) => [file.id, file] as const));
  }, [state.allFiles]);

  const activeFileSummary = useMemo(() => {
    if (!state.activeFileId) {
      return null;
    }

    return state.fileSummaries.find((summary) => summary.fileId === state.activeFileId) ?? null;
  }, [state.activeFileId, state.fileSummaries]);

  const activeFileFeatureSummaries = useMemo(() => {
    const activeFileId = state.activeFileId;
    if (!activeFileId) {
      return [];
    }

    return state.sequencePairs.filter((pair) => {
      return pair.before.fileIds.includes(activeFileId)
        || pair.after.fileIds.includes(activeFileId);
    });
  }, [state.activeFileId, state.sequencePairs]);

  const selectedAuthorComments = useMemo(() => {
    if (!selectedCommentAuthorKey) {
      return [];
    }

    return state.commitCommentActivities.filter(
      (comment) => comment.authorKey === selectedCommentAuthorKey,
    );
  }, [selectedCommentAuthorKey, state.commitCommentActivities]);

  const openUserCommentsView = useCallback(() => {
    if (!selectedCommentAuthorKey && state.commentAuthors.length > 0) {
      setSelectedCommentAuthorKey(state.commentAuthors[0]?.authorKey ?? null);
    }

    setShowUserCommentsModal(true);
  }, [selectedCommentAuthorKey, state.commentAuthors]);

  const activeFeatureFilteredHunks = useMemo(() => {
    const activeFile = state.activeFile;
    if (!selectedFeatureFocusId || !activeFile || state.activeFileHunks.length === 0) {
      return {
        hunks: state.activeFileHunks,
        notice: null as string | null,
      };
    }

    const selectedFeature = featureFocusOptions.find((option) => option.id === selectedFeatureFocusId);
    if (!selectedFeature) {
      return {
        hunks: state.activeFileHunks,
        notice: null as string | null,
      };
    }

    const hunkEntry = selectedFeature.hunkHeadersByFilePath.find(
      (entry) => entry.filePath === activeFile.path,
    );
    if (!hunkEntry || hunkEntry.hunkHeaders.length === 0) {
      return {
        hunks: state.activeFileHunks,
        notice: null as string | null,
      };
    }

    const hintedHeaders = hunkEntry.hunkHeaders.map((header) => normalizeHunkHeaderText(header));
    const matchedHunks = state.activeFileHunks.filter((hunk) => {
      const header = normalizeHunkHeaderText(hunk.header);
      if (header.length === 0) {
        return false;
      }

      return hintedHeaders.some((hint) => header === hint || header.includes(hint) || hint.includes(header));
    });

    if (matchedHunks.length === 0 || matchedHunks.length === state.activeFileHunks.length) {
      return {
        hunks: state.activeFileHunks,
        notice: null as string | null,
      };
    }

    return {
      hunks: matchedHunks,
      notice: "Showing feature-specific hunks",
    };
  }, [featureFocusOptions, selectedFeatureFocusId, state.activeFile, state.activeFileHunks]);

  const activeFileHunkFeatureLabelsById = useMemo(() => {
    const activeFile = state.activeFile;
    if (!activeFile || state.activeFileHunks.length === 0) {
      return {} as Readonly<Record<string, readonly string[]>>;
    }

    const labelsByHunkId = new Map<string, Set<string>>();
    state.activeFileHunks.forEach((hunk) => {
      labelsByHunkId.set(hunk.id, new Set<string>());
    });

    featureFocusOptions.forEach((feature) => {
      const hunkEntry = feature.hunkHeadersByFilePath.find((entry) => entry.filePath === activeFile.path);
      if (!hunkEntry || hunkEntry.hunkHeaders.length === 0) {
        return;
      }

      const hintedHeaders = hunkEntry.hunkHeaders.map((header) => normalizeHunkHeaderText(header));
      state.activeFileHunks.forEach((hunk) => {
        const header = normalizeHunkHeaderText(hunk.header);
        if (header.length === 0) {
          return;
        }

        const matched = hintedHeaders.some((hint) => {
          return hint.length > 0 && (header === hint || header.includes(hint) || hint.includes(header));
        });

        if (!matched) {
          return;
        }

        labelsByHunkId.get(hunk.id)?.add(feature.label);
      });
    });

    const output: Record<string, readonly string[]> = {};
    labelsByHunkId.forEach((labels, hunkId) => {
      if (labels.size > 0) {
        output[hunkId] = [...labels];
      }
    });

    return output;
  }, [featureFocusOptions, state.activeFile, state.activeFileHunks]);

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
    if (!isSequenceExplorerOpen || activeTab !== "sequence" || sequenceExplorerTabFileIds.length > 0) {
      return;
    }

    const initialFileId = state.activeFileId ?? state.allFiles[0]?.id ?? null;
    if (!initialFileId) {
      return;
    }

    setSequenceExplorerTabFileIds([initialFileId]);
    setSequenceExplorerActiveFileId(initialFileId);
    if (state.activeFileId !== initialFileId) {
      actions.selectFile(initialFileId);
    }
  }, [
    actions,
    activeTab,
    isSequenceExplorerOpen,
    sequenceExplorerTabFileIds.length,
    state.activeFileId,
    state.allFiles,
  ]);

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
      activeTab !== "sequence" ||
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

  const openSequenceFilesInExplorer = useCallback(
    (fileIds: readonly string[]) => {
      const uniqueFileIds = [...new Set(fileIds.filter((fileId) => filesById.has(fileId)))];
      if (uniqueFileIds.length === 0) {
        return;
      }

      setIsSequenceExplorerOpen(true);
      setActiveTab("sequence");

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
    return normalizedName.length > 0;
  }, [reviewerName]);

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
    if (state.commentAuthors.length === 0) {
      setSelectedCommentAuthorKey(null);
      return;
    }

    const hasSelection = selectedCommentAuthorKey
      ? state.commentAuthors.some((author) => author.authorKey === selectedCommentAuthorKey)
      : false;
    if (hasSelection) {
      return;
    }

    setSelectedCommentAuthorKey(state.commentAuthors[0]?.authorKey ?? null);
  }, [selectedCommentAuthorKey, state.commentAuthors]);

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
      setSelectedFeatureFocusId(null);
      setSidebarFocus(null);
      setActiveTab("files");
      setShowProjectSwitcher(false);
      setShowBranchSwitcher(false);
      setIsSequenceExplorerOpen(true);
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

      if (normalizedName.length === 0) {
        setStartupMessage("Set your reviewer name before starting a review.");
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

  const readTrackingStatusFromSettings = useCallback(
    async (repositoryPath: string): Promise<AgentTrackingStatus> => {
      const normalizedRepositoryPath = normalizeInputValue(repositoryPath);
      if (normalizedRepositoryPath.length === 0) {
        return {
          enabled: false,
          hasTrackingBlock: false,
          hasAgentReference: false,
          hasCommitContextSchema: false,
        };
      }

      return readAgentTrackingStatus(normalizedRepositoryPath);
    },
    [],
  );

  const removeTrackingFromSettings = useCallback(
    async (repositoryPath: string): Promise<AgentTrackingRemovalResult> => {
      const normalizedRepositoryPath = normalizeInputValue(repositoryPath);
      if (normalizedRepositoryPath.length === 0) {
        throw new Error("Open a project first to remove tracking files.");
      }

      return removeAgentTracking(normalizedRepositoryPath);
    },
    [],
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

    if (commitFeedHydratedRepositoryRef.current !== normalizedRepositoryPath) {
      commitFeedHydratedRepositoryRef.current = normalizedRepositoryPath;
      void actions.refreshRepositoryCommits(normalizedRepositoryPath, 15);
    }

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
          await actions.refreshRepositoryCommits(normalizedRepositoryPath, 15);
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
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }

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
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }

      const hasCommandModifier = event.metaKey || event.ctrlKey;
      if (!hasCommandModifier || event.shiftKey || event.altKey) {
        return;
      }

      if (event.key.toLowerCase() !== "w") {
        return;
      }

      if (
        !isSequenceExplorerOpen ||
        activeTab !== "sequence" ||
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

    if (tabId === "sequence") {
      setIsSequenceExplorerOpen(true);
      return;
    }

    setSelectedFeatureFocusId(null);
    setSidebarFocus(null);
    setIsSequenceExplorerOpen(false);
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
            <div className="px-4 py-4">
              <Skeleton height={13} width="38%" className="mb-2" />
              <Skeleton height={11} count={6} />
            </div>
          )}

          {sequenceExplorerActiveFile && isSequenceExplorerDiffReady && (
            <DiffViewer
              file={state.activeFile}
              hunks={state.activeFileHunks}
              hunkFeatureLabelsById={activeFileHunkFeatureLabelsById}
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
              onSetThreadStatus={actions.setThreadStatus}
              onCreateThread={actions.createThread}
              defaultAuthorId={reviewerAuthorId}
              toolbarActions={(
                <>
                  <Button
                    size="sm"
                    variant={showInlineComments ? "secondary" : "ghost"}
                    onClick={() => setShowInlineComments((current) => !current)}
                    className="h-9 w-9 px-0 text-text hover:text-text"
                    aria-label={showInlineComments ? "Hide comments" : "Show comments"}
                    title={showInlineComments ? "Hide comments" : "Show comments"}
                  >
                    <CommentsIcon muted={!showInlineComments} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={openUserCommentsView}
                    className="h-9 w-9 px-0 text-text hover:text-text"
                    aria-label="View comments by user"
                    title="View comments by user"
                    disabled={state.commentAuthors.length === 0}
                  >
                    <UserCommentsIcon />
                  </Button>
                </>
              )}
            />
          )}
        </div>
      </div>
    );
  }, [
    actions,
    activeFileHunkFeatureLabelsById,
    closeSequenceExplorerTab,
    isSequenceExplorerDiffReady,
    resolvedSequenceExplorerActiveFileId,
    reviewerAuthorId,
    selectSequenceExplorerTab,
    sequenceExplorerActiveFile,
    sequenceExplorerTabs,
    showInlineComments,
    openUserCommentsView,
    state.activeFile,
    state.activeFileHunks,
    state.activeFileVersions,
    state.activeFileVersionsError,
    state.activeFileVersionsStatus,
    state.commentAuthors,
    state.diffOrientation,
    state.diffViewMode,
    state.threadModels,
  ]);

  useEffect(() => {
    if (activeTab === "sequence") {
      setIsSidebarCollapsed(true);
      return;
    }

    setIsSidebarCollapsed(false);
  }, [activeTab]);

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
          title="Open branch switcher"
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
                <div className="space-y-2 px-3 py-3">
                  <Skeleton height={12} width="56%" />
                  <Skeleton height={30} count={4} />
                </div>
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

  const showCopyPlanFeedback = useCallback(
    (tone: "success" | "error", message: string) => {
      if (copyPlanFeedbackTimerRef.current !== null) {
        clearTimeout(copyPlanFeedbackTimerRef.current);
      }

      setCopyPlanFeedback({
        tone,
        message,
      });

      copyPlanFeedbackTimerRef.current = setTimeout(() => {
        setCopyPlanFeedback(null);
        copyPlanFeedbackTimerRef.current = null;
      }, 4000);
    },
    [],
  );

  const handleCopyPlan = useCallback(() => {
    if (isCopyingPlan) {
      return;
    }

    setIsCopyingPlan(true);
    void actions.copyPlanToClipboard()
      .then((result) => {
        if (result.ok) {
          showCopyPlanFeedback("success", result.message);
          return;
        }

        showCopyPlanFeedback("error", result.message);
      })
      .catch((error) => {
        const message = error instanceof Error
          ? error.message
          : "Failed to copy plan to clipboard.";
        showCopyPlanFeedback("error", message);
      })
      .finally(() => {
        setIsCopyingPlan(false);
      });
  }, [actions, isCopyingPlan, showCopyPlanFeedback]);

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
            variant="secondary"
            size="sm"
            className="h-8 px-2 text-[11px] font-medium"
            onClick={actions.refreshAiAnalysis}
            disabled={!state.commit || state.aiAnalysisStatus === "analysing"}
            title="Run AI analysis for the selected commit"
          >
            {state.aiAnalysisStatus === "analysing" ? "Running AI..." : "Run AI Analysis"}
          </Button>
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
            onClick={handleCopyPlan}
            disabled={!state.isPublishingReady || isCopyingPlan}
          >
            {isCopyingPlan ? "Copying..." : "Copy Plan"}
          </Button>
        </div>
      </div>

      {copyPlanFeedback && (
        <div className="border-b border-border px-4 py-1 text-xs">
          <p className={copyPlanFeedback.tone === "error" ? "text-danger" : "text-muted"}>
            {copyPlanFeedback.message}
          </p>
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
          <CardBody className="py-8">
            <div className="mx-auto w-full max-w-3xl space-y-4">
              <Skeleton height={18} width="34%" />
              <Skeleton height={12} count={2} />
              <div className="grid gap-3 md:grid-cols-2">
                <Skeleton height={120} />
                <Skeleton height={120} />
              </div>
            </div>
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

    if (activeTab === "sequence") {
      return (
        <div className="h-full min-h-0 overflow-hidden p-2 xl:p-3">
          <div className="h-full min-h-0 overflow-hidden rounded-md border border-border/50 bg-transparent">
            <CodeSequenceDiagramPanel
              steps={state.codeSequenceSteps}
              sequenceGenerationStatus={state.aiSequenceStatus}
              sequenceGenerationError={state.aiSequenceError}
              onRetrySequenceGeneration={actions.retrySequenceGeneration}
              highlightedFileIds={highlightedFileIds}
              onSelectFiles={(fileIds) => {
                setHighlightedFileIds(fileIds);
                setSelectedFeatureFocusId(null);
                setSidebarFocus({
                  label: "Sequence focus",
                  fileIds,
                });
                actions.selectFile(fileIds[0] ?? null);
              }}
              mode="expanded"
              onOpenExpandedFiles={openSequenceFilesInExplorer}
              expandedSidePanel={sequenceExpandedSidePanel}
            />
          </div>
        </div>
      );
    }

    if (activeTab === "files") {
      const fileToolbarActions = (
        <>
          <Button
            size="sm"
            variant={
              state.fileInspectionMode === "summary"
                ? "ghost"
                : showInlineComments
                ? "secondary"
                : "ghost"
            }
            onClick={() => setShowInlineComments((current) => !current)}
            className="h-9 w-9 px-0 text-text hover:text-text"
            aria-label={showInlineComments ? "Hide comments" : "Show comments"}
            title={showInlineComments ? "Hide comments" : "Show comments"}
          >
            <CommentsIcon muted={!showInlineComments} />
          </Button>
          <Button
            size="sm"
            variant={state.fileInspectionMode === "summary" ? "primary" : "ghost"}
            onClick={() => {
              actions.setFileInspectionMode(
                state.fileInspectionMode === "summary" ? "diff" : "summary",
              );
            }}
            className="h-9 w-9 px-0 text-text hover:text-text"
            aria-label={state.fileInspectionMode === "summary" ? "Show code diff" : "Show file summary"}
            title={state.fileInspectionMode === "summary" ? "Show code diff" : "Show file summary"}
            disabled={!state.activeFile}
          >
            <SummaryIcon />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={openUserCommentsView}
            className="h-9 w-9 px-0 text-text hover:text-text"
            aria-label="View comments by user"
            title="View comments by user"
            disabled={state.commentAuthors.length === 0}
          >
            <UserCommentsIcon />
          </Button>
        </>
      );

      return (
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1">
            {state.fileInspectionMode === "summary" ? (
              <DiffViewer
                file={state.activeFile}
                hunks={activeFeatureFilteredHunks.hunks}
                featureHunkNotice={activeFeatureFilteredHunks.notice}
                hunkFeatureLabelsById={activeFileHunkFeatureLabelsById}
                threads={state.threadModels}
                showInlineThreads={showInlineComments}
                orientation={state.diffOrientation}
                viewMode={state.diffViewMode}
                fileVersions={state.activeFileVersions}
                fileVersionsStatus={state.activeFileVersionsStatus}
                fileVersionsError={state.activeFileVersionsError}
                onOrientationChange={(orientation) => {
                  actions.setDiffOrientation(orientation);
                  actions.setFileInspectionMode("diff");
                }}
                onViewModeChange={(mode) => {
                  actions.setDiffViewMode(mode);
                  actions.setFileInspectionMode("diff");
                }}
                onAskAgent={actions.askAgent}
                onDeleteComment={actions.deleteComment}
                onSetThreadStatus={actions.setThreadStatus}
                onCreateThread={actions.createThread}
                defaultAuthorId={reviewerAuthorId}
                toolbarActions={fileToolbarActions}
                bodyOverride={(
                  <FileSummaryInspector
                    file={state.activeFile}
                    fileSummary={activeFileSummary}
                    relatedFeatures={activeFileFeatureSummaries}
                    aiAnalysisStatus={state.aiAnalysisStatus}
                    onRetryAiAnalysis={actions.refreshAiAnalysis}
                    onOpenFeatureFiles={(fileIds) => {
                      const uniqueFileIds = [...new Set(fileIds.filter((fileId) => filesById.has(fileId)))];
                      if (uniqueFileIds.length === 0) {
                        return;
                      }

                      setHighlightedFileIds(uniqueFileIds);
                      setSelectedFeatureFocusId(null);
                      setSidebarFocus({
                        label: "Feature Focus",
                        fileIds: uniqueFileIds,
                      });
                      actions.selectFile(uniqueFileIds[0] ?? null);
                      actions.setFileInspectionMode("diff");
                    }}
                  />
                )}
              />
            ) : (
              <DiffViewer
                file={state.activeFile}
                hunks={activeFeatureFilteredHunks.hunks}
                featureHunkNotice={activeFeatureFilteredHunks.notice}
                hunkFeatureLabelsById={activeFileHunkFeatureLabelsById}
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
                onSetThreadStatus={actions.setThreadStatus}
                onCreateThread={actions.createThread}
                defaultAuthorId={reviewerAuthorId}
                toolbarActions={fileToolbarActions}
              />
            )}
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
            impactClusters={state.architectureClusters}
            featureSummaries={state.sequencePairs}
            aiAnalysisStatus={state.aiAnalysisStatus}
            onRetryAiAnalysis={actions.refreshAiAnalysis}
            onOpenImpactFiles={(fileIds) => {
              const uniqueFileIds = [...new Set(fileIds.filter((fileId) => filesById.has(fileId)))];
              if (uniqueFileIds.length === 0) {
                return;
              }

              setHighlightedFileIds(uniqueFileIds);
              setSelectedFeatureFocusId(null);
              setSidebarFocus({
                label: "Impact Focus",
                fileIds: uniqueFileIds,
              });
              actions.selectFile(uniqueFileIds[0] ?? null);
              actions.setFileInspectionMode("diff");
              setActiveTab("files");
            }}
            onOpenFeatureFiles={(fileIds) => {
              const uniqueFileIds = [...new Set(fileIds.filter((fileId) => filesById.has(fileId)))];
              if (uniqueFileIds.length === 0) {
                return;
              }

              setHighlightedFileIds(uniqueFileIds);
              setSelectedFeatureFocusId(null);
              setSidebarFocus({
                label: "Feature Focus",
                fileIds: uniqueFileIds,
              });
              actions.selectFile(uniqueFileIds[0] ?? null);
              actions.setFileInspectionMode("diff");
              setActiveTab("files");
            }}
          />
        </div>
      );
    }

    if (activeTab === "commit") {
      return (
        <CommitPanel
          commit={state.commit}
          files={state.allFiles}
          onOpenFileDiff={(fileId) => {
            setHighlightedFileIds([fileId]);
            setSelectedFeatureFocusId(null);
            setSidebarFocus(null);
            actions.selectFile(fileId);
            actions.setFileInspectionMode("diff");
            setActiveTab("files");
          }}
        />
      );
    }

    return (
      <div className="h-full overflow-auto p-3 xl:p-4">
        {(state.standardsAnalysisStatus === "analysing" ||
          (state.standardsAnalysisStatus === "idle" && state.standardsChecks.length === 0)) && (
          <Card>
            <CardBody className="py-5">
              <div className="space-y-2">
                <Skeleton height={15} width="38%" />
                <Skeleton height={12} width="72%" />
                <Skeleton height={52} />
              </div>
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
          <StandardsPanel
            checks={state.standardsChecks}
            fileInsights={state.fileStandardsInsights}
            counts={state.standardsCounts}
          />
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
    state.fileInspectionMode,
    state.fileSummaries,
    state.commentAuthors,
    state.loadStatus,
    state.overviewCards,
    state.sequencePairs,
    state.codeSequenceSteps,
    state.aiAnalysisStatus,
    state.aiSequenceStatus,
    state.aiSequenceError,
    state.standardsAnalysisStatus,
    state.standardsAnalysisError,
    state.standardsChecks,
    state.fileStandardsInsights,
    state.standardsCounts,
    state.threadModels,
    state.threadCounts,
    state.architectureClusters,
    state.repositoryCommits,
    activeFileSummary,
    activeFileFeatureSummaries,
    activeFeatureFilteredHunks,
    activeFileHunkFeatureLabelsById,
    filesById,
    showInlineComments,
    openUserCommentsView,
    reviewerAuthorId,
    isSequenceExplorerOpen,
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
          initialAutoRunOnCommitChange={autoRunOnCommitChange}
          initialProjectStandardsPath={projectStandardsPath}
          initialCliAgents={cliAgentsSettings}
          activeRepositoryPath={activeRepositoryPath}
          cmCliStatus={cmCliStatus}
          onInitializeTracking={initializeTrackingFromSettings}
          onReadTrackingStatus={readTrackingStatusFromSettings}
          onRemoveTracking={removeTrackingFromSettings}
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
          }}
          onTestApiConnection={testAnthropicApiConnection}
          onSaveMaxChurn={(n) => {
            writeAiAnalysisConfigToStorage({ maxChurnThreshold: n });
            setMaxChurnThreshold(n);
            void writeAppSettingsFile({ maxChurnThreshold: n });
          }}
          onSaveAutoRunOnCommitChange={(enabled) => {
            writeAiAnalysisConfigToStorage({ autoRunOnCommitChange: enabled });
            setAutoRunOnCommitChange(enabled);
            void writeAppSettingsFile({ autoRunOnCommitChange: enabled });
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
          onTestCliConnection={testCliAgentConnection}
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
            featureOptions={featureFocusOptions}
            selectedFeatureId={selectedFeatureFocusId}
            files={sidebarFiles}
            allFiles={state.allFiles}
            allFilesCount={state.allFiles.length}
            activeFileId={state.activeFileId}
            highlightedFileIds={highlightedFileIds}
            filter={state.fileFilter}
            threadCounts={state.threadCounts}
            filterLabel={sidebarFocus?.label ?? null}
            onClearFilter={() => {
              setSelectedFeatureFocusId(null);
              setSidebarFocus(null);
            }}
            onFeatureFilterChange={handleFeatureFilterChange}
            onQueryChange={actions.setFilterQuery}
            onThreadStatusFilterChange={actions.setThreadStatusFilter}
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
        initialAutoRunOnCommitChange={autoRunOnCommitChange}
        initialProjectStandardsPath={projectStandardsPath}
        initialCliAgents={cliAgentsSettings}
        activeRepositoryPath={activeRepositoryPath}
        cmCliStatus={cmCliStatus}
        onInitializeTracking={initializeTrackingFromSettings}
        onReadTrackingStatus={readTrackingStatusFromSettings}
        onRemoveTracking={removeTrackingFromSettings}
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
        }}
        onTestApiConnection={testAnthropicApiConnection}
        onSaveMaxChurn={(n) => {
          writeAiAnalysisConfigToStorage({ maxChurnThreshold: n });
          setMaxChurnThreshold(n);
          void writeAppSettingsFile({ maxChurnThreshold: n });
        }}
        onSaveAutoRunOnCommitChange={(enabled) => {
          writeAiAnalysisConfigToStorage({ autoRunOnCommitChange: enabled });
          setAutoRunOnCommitChange(enabled);
          void writeAppSettingsFile({ autoRunOnCommitChange: enabled });
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
        onTestCliConnection={testCliAgentConnection}
        onClose={() => setShowSettings(false)}
      />
      <UserCommentsModal
        open={showUserCommentsModal}
        authors={state.commentAuthors}
        selectedAuthorKey={selectedCommentAuthorKey}
        comments={selectedAuthorComments}
        onSelectAuthorKey={(authorKey) => setSelectedCommentAuthorKey(authorKey)}
        onClose={() => setShowUserCommentsModal(false)}
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
