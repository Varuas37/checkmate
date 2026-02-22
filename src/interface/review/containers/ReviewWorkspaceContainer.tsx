import { useCallback, useMemo, useState } from "react";

import {
  AppFrame,
  Badge,
  Button,
  Card,
  CardBody,
  CardDescription,
  Input,
  ThemeSwitcher,
} from "../../../design-system/index.ts";
import { DEFAULT_LOAD_REQUEST, DEFAULT_STANDARDS_RULE_TEXT, REVIEW_TABS, SAMPLE_COMMIT_PRESETS } from "../constants.ts";
import {
  ChangedFilesSidebar,
  DiffViewer,
  FileThreadsPanel,
  OverviewPanel,
  StandardsPanel,
  SummaryPanel,
  TopTabs,
} from "../components/index.ts";
import { useReviewWorkspace } from "../hooks/useReviewWorkspace.ts";
import type { ReviewLoadRequest, ReviewTabId } from "../types.ts";

const CUSTOM_PRESET_ID = "custom-commit";

function statusToneForLoad(loadStatus: "idle" | "loading" | "loaded" | "error"): "neutral" | "accent" | "positive" | "danger" {
  if (loadStatus === "loading") {
    return "accent";
  }

  if (loadStatus === "loaded") {
    return "positive";
  }

  if (loadStatus === "error") {
    return "danger";
  }

  return "neutral";
}

export function ReviewWorkspaceContainer() {
  const { state, actions } = useReviewWorkspace();
  const [activeTab, setActiveTab] = useState<ReviewTabId>("overview");
  const [highlightedFileIds, setHighlightedFileIds] = useState<readonly string[]>([]);
  const [repositoryPathInput, setRepositoryPathInput] = useState(DEFAULT_LOAD_REQUEST.repositoryPath);
  const [commitShaInput, setCommitShaInput] = useState(DEFAULT_LOAD_REQUEST.commitSha);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    SAMPLE_COMMIT_PRESETS[0]?.id ?? CUSTOM_PRESET_ID,
  );
  const [sidebarFocus, setSidebarFocus] = useState<{
    readonly label: string;
    readonly fileIds: readonly string[];
  } | null>(null);

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

  const triggerCommitReload = useCallback(
    (request: ReviewLoadRequest) => {
      setHighlightedFileIds([]);
      setSidebarFocus(null);
      setActiveTab("overview");
      actions.reloadReviewWorkspace({
        repositoryPath: request.repositoryPath,
        commitSha: request.commitSha,
        standardsRuleText: DEFAULT_STANDARDS_RULE_TEXT,
      });
    },
    [actions],
  );

  const handleTabChange = useCallback((tabId: ReviewTabId) => {
    setActiveTab(tabId);

    if (tabId !== "overview") {
      setSidebarFocus(null);
    }
  }, []);

  const header = (
    <header className="rounded-t-lg border border-border bg-surface shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-sm border border-accent/35 bg-accent/12 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
              CodeLens
            </span>
            {state.commit && <Badge tone="accent">{state.commit.shortSha}</Badge>}
            <Badge tone="positive">+{totalAdditions}</Badge>
            <Badge tone="danger">-{totalDeletions}</Badge>
          </div>

          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text">
              {state.commit ? state.commit.title : "Code Review Workspace"}
            </p>
            <CardDescription className="truncate text-xs">
              {state.commit
                ? `${state.commit.authorName} · ${state.commit.repositoryPath}`
                : "Load a commit to start reviewing."}
            </CardDescription>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusToneForLoad(state.loadStatus)}>{state.loadStatus}</Badge>
          <ThemeSwitcher className="hidden sm:inline-flex" />
          <Button size="sm" onClick={actions.publishReview} disabled={!state.isPublishingReady}>
            Publish Review
          </Button>
        </div>
      </div>

      <div className="space-y-1 border-b border-border px-4 pb-3 pt-2">
        <form
          className="grid gap-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            triggerCommitReload({
              repositoryPath: repositoryPathInput,
              commitSha: commitShaInput,
            });
          }}
        >
          <label className="space-y-1 text-[11px] uppercase tracking-[0.08em] text-muted">
            Repository Path
            <Input
              value={repositoryPathInput}
              onChange={(event) => {
                setRepositoryPathInput(event.target.value);
                setSelectedPresetId(CUSTOM_PRESET_ID);
              }}
              placeholder="."
              aria-label="Repository path"
              className="h-9"
            />
          </label>

          <label className="space-y-1 text-[11px] uppercase tracking-[0.08em] text-muted">
            Commit
            <Input
              value={commitShaInput}
              onChange={(event) => {
                setCommitShaInput(event.target.value);
                setSelectedPresetId(CUSTOM_PRESET_ID);
              }}
              placeholder="HEAD"
              aria-label="Commit SHA"
              className="h-9"
            />
          </label>

          <label className="space-y-1 text-[11px] uppercase tracking-[0.08em] text-muted">
            Preset
            <select
              className="h-9 w-full rounded-md border border-border bg-canvas px-2 text-sm text-text shadow-inset"
              value={selectedPresetId}
              onChange={(event) => {
                const nextPresetId = event.target.value;
                setSelectedPresetId(nextPresetId);

                if (nextPresetId === CUSTOM_PRESET_ID) {
                  return;
                }

                const preset = SAMPLE_COMMIT_PRESETS.find((item) => item.id === nextPresetId);

                if (!preset) {
                  return;
                }

                setRepositoryPathInput(preset.repositoryPath);
                setCommitShaInput(preset.commitSha);
                triggerCommitReload({
                  repositoryPath: preset.repositoryPath,
                  commitSha: preset.commitSha,
                });
              }}
              aria-label="Sample commit quick pick"
            >
              <option value={CUSTOM_PRESET_ID}>Custom input</option>
              {SAMPLE_COMMIT_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>

          <Button type="submit" variant="secondary" className="h-9 self-end" disabled={state.loadStatus === "loading"}>
            Load
          </Button>
        </form>
      </div>

      <TopTabs tabs={REVIEW_TABS} activeTab={activeTab} onChange={handleTabChange} />
    </header>
  );

  const mainContent = useMemo(() => {
    if (state.loadStatus === "loading" || state.loadStatus === "idle") {
      return (
        <Card className="rounded-none border-0 shadow-none">
          <CardBody className="py-10 text-sm text-muted">Loading commit review data and standards checks...</CardBody>
        </Card>
      );
    }

    if (state.loadStatus === "error") {
      return (
        <Card className="rounded-none border-0 shadow-none">
          <CardBody className="py-10 text-sm text-danger">{state.errorMessage ?? "Failed to load review data."}</CardBody>
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
        <div className="space-y-4 p-4">
          <DiffViewer
            file={state.activeFile}
            hunks={state.activeFileHunks}
            orientation={state.diffOrientation}
            onOrientationChange={actions.setDiffOrientation}
          />
          <FileThreadsPanel
            commitId={state.commit?.id ?? null}
            file={state.activeFile}
            hunks={state.activeFileHunks}
            threads={state.threadModels}
            publishPackage={state.publishPackage}
            onCreateThread={actions.createThread}
            onAskAgent={actions.askAgent}
            onPublishReview={actions.publishReview}
          />
        </div>
      );
    }

    if (activeTab === "summary") {
      return (
        <div className="p-4">
          <SummaryPanel
            commit={state.commit}
            overviewCards={state.overviewCards}
            fileSummaries={state.fileSummaries}
            publishPackage={state.publishPackage}
            canPublish={state.isPublishingReady}
            onPublishReview={actions.publishReview}
          />
        </div>
      );
    }

    return (
      <div className="p-4">
        <StandardsPanel checks={state.standardsChecks} counts={state.standardsCounts} />
      </div>
    );
  }, [
    actions,
    activeTab,
    highlightedFileIds,
    state.activeFile,
    state.activeFileHunks,
    state.commit,
    state.diffOrientation,
    state.errorMessage,
    state.fileSummaries,
    state.isPublishingReady,
    state.loadStatus,
    state.overviewCards,
    state.publishPackage,
    state.sequencePairs,
    state.codeSequenceSteps,
    state.standardsChecks,
    state.standardsCounts,
    state.threadModels,
    state.architectureClusters,
  ]);

  return (
    <AppFrame
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
          onToggleStatus={actions.toggleFilterStatus}
          onOnlyCommentedChange={actions.setOnlyCommented}
          onOnlyFailingChange={actions.setOnlyFailingStandards}
          onThreadStatusChange={actions.setThreadStatusFilter}
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
  );
}
