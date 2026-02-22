import { useMemo, useState } from "react";

import { AppFrame, Badge, Card, CardBody, CardDescription, CardTitle } from "../../../design-system/index.ts";
import { REVIEW_TABS } from "../constants.ts";
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
import type { ReviewTabId } from "../types.ts";

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
