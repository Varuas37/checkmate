import { useCallback, useMemo, useState } from "react";

import {
  AppFrame,
  Badge,
  Button,
  Card,
  CardBody,
  CardDescription,
  CardTitle,
  Input,
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

  const triggerCommitReload = useCallback(
    (request: ReviewLoadRequest) => {
      setHighlightedFileIds([]);
      setActiveTab("overview");
      actions.reloadReviewWorkspace({
        repositoryPath: request.repositoryPath,
        commitSha: request.commitSha,
        standardsRuleText: DEFAULT_STANDARDS_RULE_TEXT,
      });
    },
    [actions],
  );

  const header = (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-xl">CodeLens Review Workspace</CardTitle>
            <CardDescription>
              {state.commit
                ? `${state.commit.title} · ${state.commit.shortSha} · ${state.commit.authorName}`
                : "Loading review context..."}
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusToneForLoad(state.loadStatus)}>{state.loadStatus}</Badge>
            {state.commit && <Badge tone="accent">{state.commit.repositoryPath}</Badge>}
          </div>
        </div>

        <form
          className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            triggerCommitReload({
              repositoryPath: repositoryPathInput,
              commitSha: commitShaInput,
            });
          }}
        >
          <label className="space-y-1 text-xs text-muted">
            Repository Path
            <Input
              value={repositoryPathInput}
              onChange={(event) => {
                setRepositoryPathInput(event.target.value);
                setSelectedPresetId(CUSTOM_PRESET_ID);
              }}
              placeholder="."
              aria-label="Repository path"
            />
          </label>

          <label className="space-y-1 text-xs text-muted">
            Commit SHA
            <Input
              value={commitShaInput}
              onChange={(event) => {
                setCommitShaInput(event.target.value);
                setSelectedPresetId(CUSTOM_PRESET_ID);
              }}
              placeholder="HEAD"
              aria-label="Commit SHA"
            />
          </label>

          <label className="space-y-1 text-xs text-muted">
            Sample Commits
            <select
              className="h-10 w-full rounded-md border border-border bg-surface px-2 text-sm text-text"
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

          <Button type="submit" variant="secondary" className="self-end" disabled={state.loadStatus === "loading"}>
            Load Commit
          </Button>
        </form>

        <TopTabs tabs={REVIEW_TABS} activeTab={activeTab} onChange={setActiveTab} />
      </CardBody>
    </Card>
  );

  const mainContent = useMemo(() => {
    if (state.loadStatus === "loading" || state.loadStatus === "idle") {
      return (
        <Card>
          <CardBody className="py-10 text-sm text-muted">Loading commit review data and standards checks...</CardBody>
        </Card>
      );
    }

    if (state.loadStatus === "error") {
      return (
        <Card>
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
          highlightedFileIds={highlightedFileIds}
          onSelectFiles={(fileIds) => {
            setHighlightedFileIds(fileIds);
            const firstFileId = fileIds[0] ?? null;
            actions.selectFile(firstFileId);
            setActiveTab("files");
          }}
        />
      );
    }

    if (activeTab === "files") {
      return (
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_24rem]">
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
        <SummaryPanel
          commit={state.commit}
          overviewCards={state.overviewCards}
          fileSummaries={state.fileSummaries}
          publishPackage={state.publishPackage}
          canPublish={state.isPublishingReady}
          onPublishReview={actions.publishReview}
        />
      );
    }

    return <StandardsPanel checks={state.standardsChecks} counts={state.standardsCounts} />;
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
          files={state.filteredFiles}
          allFilesCount={state.allFiles.length}
          activeFileId={state.activeFileId}
          highlightedFileIds={highlightedFileIds}
          filter={state.fileFilter}
          onQueryChange={actions.setFilterQuery}
          onToggleStatus={actions.toggleFilterStatus}
          onOnlyCommentedChange={actions.setOnlyCommented}
          onOnlyFailingChange={actions.setOnlyFailingStandards}
          onThreadStatusChange={actions.setThreadStatusFilter}
          onSelectFile={(fileId) => {
            setHighlightedFileIds([fileId]);
            actions.selectFile(fileId);
          }}
        />
      }
    >
      {mainContent}
    </AppFrame>
  );
}
