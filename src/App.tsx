import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";

import "./App.css";

import { DiagramCanvas } from "./flow/interface/components/DiagramCanvas";
import { StepDetailsPanel } from "./flow/interface/components/StepDetailsPanel";
import { TimelineControls } from "./flow/interface/components/TimelineControls";
import { DEFAULT_FLOW_SCHEMA } from "./flow/interface/defaultSchema";
import { useCodePreview } from "./flow/interface/hooks/useCodePreview";
import { useTimeline } from "./flow/interface/hooks/useTimeline";
import {
  loadCommitReviewFromRepo,
  loadRepoCommits,
  loadAgentWorkflowFromRepo,
  parseUploadedFlowSchema,
} from "./flow/interface/parserGateway";
import type {
  CommitReviewPayload,
  FlowSchema,
  RepoCommit,
  ValidationIssue,
} from "./flow/interface/types";

const DEFAULT_REPO_PATH = "/Users/clawdia/Documents/Projects/clawdia";

function App(): JSX.Element {
  const [schema, setSchema] = useState<FlowSchema>(DEFAULT_FLOW_SCHEMA);
  const [validationErrors, setValidationErrors] = useState<ValidationIssue[]>([]);
  const [activeSource, setActiveSource] = useState("Built-in sample");
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isLoadingRepoWorkflow, setIsLoadingRepoWorkflow] = useState(false);
  const [isLoadingCommitList, setIsLoadingCommitList] = useState(false);
  const [isLoadingCommitReview, setIsLoadingCommitReview] = useState(false);
  const [analysisRepoPath, setAnalysisRepoPath] = useState(DEFAULT_REPO_PATH);
  const [repoCommits, setRepoCommits] = useState<RepoCommit[]>([]);
  const [selectedCommitHash, setSelectedCommitHash] = useState("");
  const [commitReview, setCommitReview] = useState<CommitReviewPayload | null>(null);
  const [selectedDiffPath, setSelectedDiffPath] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [codeRepoRoot, setCodeRepoRoot] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Upload a schema file to animate your own flow.");

  const timeline = useTimeline(schema.trace.length);
  const currentStep = schema.trace[timeline.currentStepIndex] ?? null;
  const codePreview = useCodePreview(currentStep?.codeRef ?? null, codeRepoRoot);

  const selectedChangedFile = useMemo(() => {
    if (commitReview === null || commitReview.changedFiles.length === 0) {
      return null;
    }

    if (selectedDiffPath !== null) {
      const matched = commitReview.changedFiles.find((file) => file.path === selectedDiffPath);
      if (matched !== undefined) {
        return matched;
      }
    }

    return commitReview.changedFiles[0] ?? null;
  }, [commitReview, selectedDiffPath]);

  const focusedNodeIds = useMemo(() => {
    return new Set(currentStep?.focusNodeIds ?? []);
  }, [currentStep]);

  const focusedEdgeIds = useMemo(() => {
    return new Set(currentStep?.focusEdgeIds ?? []);
  }, [currentStep]);

  useEffect(() => {
    if (currentStep === null) {
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      return;
    }

    setSelectedNodeId(currentStep.focusNodeIds[0] ?? null);
    setSelectedEdgeId(currentStep.focusEdgeIds[0] ?? null);

    if (commitReview !== null) {
      const hasFileForStep = commitReview.changedFiles.some(
        (changedFile) => changedFile.path === currentStep.codeRef.path,
      );
      if (hasFileForStep) {
        setSelectedDiffPath(currentStep.codeRef.path);
      }
    }
  }, [commitReview, currentStep]);

  const clearCommitReviewContext = (): void => {
    setCommitReview(null);
    setSelectedDiffPath(null);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const inputElement = event.currentTarget;
    const file = inputElement.files?.[0];
    if (file === undefined) {
      return;
    }

    setIsLoadingFile(true);
    setActiveSource(file.name);
    setValidationErrors([]);
    setStatusMessage(`Validating '${file.name}'...`);

    try {
      const fileContent = await file.text();
      const parseResult = await parseUploadedFlowSchema(fileContent);

      if (!parseResult.ok) {
        setValidationErrors(parseResult.errors);
        setStatusMessage(`Could not load '${file.name}'. Review validation errors.`);
        return;
      }

      setSchema(parseResult.value);
      setCodeRepoRoot(null);
      clearCommitReviewContext();
      setValidationErrors([]);
      timeline.reset(0);
      setStatusMessage(
        `Loaded '${file.name}' with ${parseResult.value.diagram.nodes.length} nodes and ${parseResult.value.trace.length} steps.`,
      );
    } catch (error) {
      setValidationErrors([
        {
          message: error instanceof Error ? error.message : "Unexpected file loading error.",
          path: "file",
        },
      ]);
      setStatusMessage(`Unexpected error while loading '${file.name}'.`);
    } finally {
      setIsLoadingFile(false);
      inputElement.value = "";
    }
  };

  const handleRefreshCommits = async (): Promise<void> => {
    const normalizedRepoPath = analysisRepoPath.trim();
    if (normalizedRepoPath.length === 0) {
      setValidationErrors([{ path: "repoPath", message: "Repository path is required." }]);
      return;
    }

    setIsLoadingCommitList(true);
    setValidationErrors([]);
    setStatusMessage(`Loading commits from ${normalizedRepoPath}...`);

    const listResult = await loadRepoCommits(normalizedRepoPath, 50);
    if (!listResult.ok) {
      setValidationErrors(listResult.errors);
      setStatusMessage("Could not load commit list. Review validation errors.");
      setIsLoadingCommitList(false);
      return;
    }

    setRepoCommits(listResult.commits);
    setCodeRepoRoot(listResult.repoRoot);
    setSelectedCommitHash((previousHash) => {
      if (previousHash.length > 0 && listResult.commits.some((commit) => commit.hash === previousHash)) {
        return previousHash;
      }
      return listResult.commits[0]?.hash ?? "";
    });
    setStatusMessage(`Loaded ${listResult.commits.length} commits from ${listResult.repoRoot}.`);
    setIsLoadingCommitList(false);
  };

  const handleLoadAgentWorkflow = async (): Promise<void> => {
    const normalizedRepoPath = analysisRepoPath.trim();
    if (normalizedRepoPath.length === 0) {
      setValidationErrors([{ path: "repoPath", message: "Repository path is required." }]);
      return;
    }

    setIsLoadingRepoWorkflow(true);
    setValidationErrors([]);
    setStatusMessage(`Analyzing ${normalizedRepoPath}...`);

    const loadResult = await loadAgentWorkflowFromRepo(normalizedRepoPath);
    if (!loadResult.ok) {
      setValidationErrors(loadResult.errors);
      setStatusMessage("Could not load repository workflow. Review validation errors.");
      setIsLoadingRepoWorkflow(false);
      return;
    }

    setSchema(loadResult.value);
    setCodeRepoRoot(loadResult.repoRoot);
    clearCommitReviewContext();
    setActiveSource(`${loadResult.source} (${loadResult.repoRoot})`);
    timeline.reset(0);
    setStatusMessage(
      `Loaded ${loadResult.value.trace.length} workflow steps from ${loadResult.repoRoot}.`,
    );
    setIsLoadingRepoWorkflow(false);
  };

  const handleLoadSelectedCommitReview = async (): Promise<void> => {
    const normalizedRepoPath = analysisRepoPath.trim();
    if (normalizedRepoPath.length === 0) {
      setValidationErrors([{ path: "repoPath", message: "Repository path is required." }]);
      return;
    }

    if (selectedCommitHash.length === 0) {
      setValidationErrors([{ path: "commit", message: "Select a commit first." }]);
      return;
    }

    setIsLoadingCommitReview(true);
    setValidationErrors([]);
    setStatusMessage(`Analyzing commit ${selectedCommitHash.slice(0, 8)}...`);

    const reviewResult = await loadCommitReviewFromRepo(normalizedRepoPath, selectedCommitHash);
    if (!reviewResult.ok) {
      setValidationErrors(reviewResult.errors);
      setStatusMessage("Could not load commit review. Review validation errors.");
      setIsLoadingCommitReview(false);
      return;
    }

    setCommitReview(reviewResult.value);
    setSchema(reviewResult.value.schema);
    setCodeRepoRoot(reviewResult.value.repoRoot);
    setSelectedDiffPath(reviewResult.value.changedFiles[0]?.path ?? null);
    setActiveSource(
      `${reviewResult.value.source} ${reviewResult.value.commit.shortHash} (${reviewResult.value.repoRoot})`,
    );
    timeline.reset(0);
    setStatusMessage(
      `Loaded commit ${reviewResult.value.commit.shortHash}: ${reviewResult.value.changedFiles.length} changed files.`,
    );
    setIsLoadingCommitReview(false);
  };

  const handleNodeClick = (nodeId: string): void => {
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);

    const stepIndex = schema.trace.findIndex((step) => step.focusNodeIds.includes(nodeId));
    if (stepIndex >= 0) {
      timeline.goTo(stepIndex);
    }
  };

  const handleEdgeClick = (edgeId: string): void => {
    setSelectedEdgeId(edgeId);
    setSelectedNodeId(null);

    const stepIndex = schema.trace.findIndex((step) => step.focusEdgeIds.includes(edgeId));
    if (stepIndex >= 0) {
      timeline.goTo(stepIndex);
    }
  };

  const handleSelectChangedFile = (filePath: string): void => {
    setSelectedDiffPath(filePath);
    const stepIndex = schema.trace.findIndex((step) => step.codeRef.path === filePath);
    if (stepIndex >= 0) {
      timeline.goTo(stepIndex);
    }
  };

  const formatRelativeDate = (isoDate: string): string => {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) {
      return isoDate;
    }
    return date.toLocaleString();
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="title-group">
          <p className="app-kicker">Easy Visualization MVP</p>
          <h1>Flow Animation Workspace</h1>
          <p className="app-subtitle">
            Load repo commits, inspect each changed area visually, and review code diffs without losing flow context.
          </p>
        </div>

        <div className="header-actions">
          <div className="repo-workflow-group">
            <label className="field-label" htmlFor="repo-path-input">
              Repo Path
            </label>
            <div className="repo-load-row repo-load-row--full">
              <input
                id="repo-path-input"
                className="repo-path-input"
                type="text"
                value={analysisRepoPath}
                onChange={(event) => setAnalysisRepoPath(event.target.value)}
                placeholder="/Users/.../your-repo"
              />
              <button
                type="button"
                className="action-btn action-btn--secondary"
                onClick={() => void handleRefreshCommits()}
                disabled={isLoadingCommitList || isLoadingRepoWorkflow || isLoadingCommitReview}
              >
                {isLoadingCommitList ? "Loading..." : "Refresh Commits"}
              </button>
            </div>
            <div className="repo-load-row">
              <select
                className="repo-path-input commit-select"
                value={selectedCommitHash}
                onChange={(event) => setSelectedCommitHash(event.target.value)}
                disabled={repoCommits.length === 0 || isLoadingCommitReview}
              >
                <option value="">{repoCommits.length === 0 ? "No commits loaded" : "Select a commit"}</option>
                {repoCommits.map((commit) => (
                  <option key={commit.hash} value={commit.hash}>
                    {commit.shortHash} - {commit.subject}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="action-btn"
                onClick={() => void handleLoadSelectedCommitReview()}
                disabled={isLoadingCommitReview || selectedCommitHash.length === 0}
              >
                {isLoadingCommitReview ? "Analyzing..." : "Load Commit Review"}
              </button>
            </div>
            <div className="repo-load-row">
              <button
                type="button"
                className="action-btn action-btn--secondary"
                onClick={() => void handleLoadAgentWorkflow()}
                disabled={isLoadingRepoWorkflow || isLoadingCommitReview}
              >
                {isLoadingRepoWorkflow ? "Analyzing..." : "Load Agent Workflow"}
              </button>
              <p className="repo-helper-text">
                {repoCommits.length > 0
                  ? `${repoCommits.length} commits loaded`
                  : "Load commits first to review changes per commit"}
              </p>
            </div>
          </div>

          <div className="upload-group">
            <label className="file-upload">
              <input
                type="file"
                accept=".json,application/json"
                onChange={handleFileUpload}
                disabled={isLoadingFile || isLoadingRepoWorkflow || isLoadingCommitReview}
              />
              <span>{isLoadingFile ? "Loading..." : "Load JSON Schema"}</span>
            </label>
            <p className="file-meta">Source: {activeSource}</p>
          </div>
        </div>
      </header>

      <p className="status-line">{statusMessage}</p>

      <main className="layout-grid">
        <section className="left-column">
          <article className="panel diagram-panel">
            <h2 className="panel-title">Diagram Canvas</h2>
            <DiagramCanvas
              diagram={schema.diagram}
              focusedNodeIds={focusedNodeIds}
              focusedEdgeIds={focusedEdgeIds}
              selectedNodeId={selectedNodeId}
              selectedEdgeId={selectedEdgeId}
              onNodeClick={handleNodeClick}
              onEdgeClick={handleEdgeClick}
            />
          </article>

          <article className="panel timeline-panel">
            <h2 className="panel-title">Playback Controls</h2>
            <TimelineControls
              currentStepIndex={timeline.currentStepIndex}
              totalSteps={schema.trace.length}
              isPlaying={timeline.isPlaying}
              speed={timeline.speed}
              onPlay={timeline.play}
              onPause={timeline.pause}
              onNext={timeline.next}
              onPrevious={timeline.previous}
              onSpeedChange={timeline.setSpeed}
            />
          </article>

          <article className="panel step-nav-panel">
            <h2 className="panel-title">Workflow Step Navigator</h2>
            <div className="step-nav-list" role="list" aria-label="Workflow steps">
              {schema.trace.map((step, index) => {
                const isActive = index === timeline.currentStepIndex;
                return (
                  <button
                    key={step.id}
                    type="button"
                    role="listitem"
                    className={`step-nav-item ${isActive ? "step-nav-item--active" : ""}`}
                    onClick={() => timeline.goTo(index)}
                  >
                    <span className="step-nav-index">{index + 1}</span>
                    <span className="step-nav-text">
                      <span className="step-nav-title">{step.title}</span>
                      {step.description !== undefined ? (
                        <span className="step-nav-description">{step.description}</span>
                      ) : null}
                      <span className="step-nav-code">
                        {step.codeRef.path}:{step.codeRef.line}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </article>

          {commitReview !== null ? (
            <article className="panel commit-overview-panel">
              <h2 className="panel-title">Commit Overview</h2>
              <div className="commit-meta-grid">
                <p className="commit-meta-line">
                  <span className="commit-meta-label">Commit</span>
                  <span className="commit-meta-value">
                    {commitReview.commit.shortHash} - {commitReview.commit.subject}
                  </span>
                </p>
                <p className="commit-meta-line">
                  <span className="commit-meta-label">Author</span>
                  <span className="commit-meta-value">{commitReview.commit.author}</span>
                </p>
                <p className="commit-meta-line">
                  <span className="commit-meta-label">Date</span>
                  <span className="commit-meta-value">{formatRelativeDate(commitReview.commit.date)}</span>
                </p>
              </div>
              <div className="commit-summary-block">
                <p className="tag-label">Prompt</p>
                <p className="commit-summary-text">{commitReview.prompt}</p>
              </div>
              <div className="commit-summary-block">
                <p className="tag-label">AI Summary</p>
                <p className="commit-summary-text">{commitReview.overallSummary}</p>
              </div>
            </article>
          ) : null}

          {commitReview !== null ? (
            <article className="panel changed-files-panel">
              <h2 className="panel-title">Changed Files</h2>
              <div className="changed-files-list" role="list" aria-label="Changed files">
                {commitReview.changedFiles.map((file) => {
                  const isActive = selectedChangedFile?.path === file.path;
                  return (
                    <button
                      key={file.path}
                      type="button"
                      role="listitem"
                      className={`changed-file-item ${isActive ? "changed-file-item--active" : ""}`}
                      onClick={() => handleSelectChangedFile(file.path)}
                    >
                      <span className="changed-file-path">{file.path}</span>
                      <span className="changed-file-meta">
                        <span className="changed-file-status">{file.status}</span>
                        <span className="changed-file-additions">+{file.additions}</span>
                        <span className="changed-file-deletions">-{file.deletions}</span>
                      </span>
                      <span className="changed-file-summary">{file.summary}</span>
                    </button>
                  );
                })}
              </div>
            </article>
          ) : null}

          {commitReview !== null ? (
            <article className="panel diff-panel">
              <h2 className="panel-title">Diff Viewer</h2>
              {selectedChangedFile !== null ? (
                <div className="diff-viewer">
                  <p className="diff-file-label">{selectedChangedFile.path}</p>
                  <div className="diff-content" role="region" aria-label="Selected file diff">
                    {selectedChangedFile.diff.split("\n").map((line, index) => {
                      let className = "diff-line";
                      if (line.startsWith("@@")) {
                        className = "diff-line diff-line--hunk";
                      } else if (line.startsWith("+") && !line.startsWith("+++")) {
                        className = "diff-line diff-line--added";
                      } else if (line.startsWith("-") && !line.startsWith("---")) {
                        className = "diff-line diff-line--removed";
                      } else if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
                        className = "diff-line diff-line--header";
                      }

                      return (
                        <div key={`${selectedChangedFile.path}-${index}`} className={className}>
                          {line || " "}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="placeholder">Select a changed file to inspect its diff.</p>
              )}
            </article>
          ) : null}

          {validationErrors.length > 0 ? (
            <article className="panel error-panel">
              <h2 className="panel-title">Validation Errors</h2>
              <ul className="error-list">
                {validationErrors.map((issue, index) => (
                  <li key={`${issue.path ?? "root"}-${index}`}>
                    <span>{issue.message}</span>
                    {issue.path !== undefined ? <span className="error-path">({issue.path})</span> : null}
                  </li>
                ))}
              </ul>
            </article>
          ) : null}
        </section>

        <aside className="panel details-panel" key={currentStep?.id ?? "empty-step"}>
          <StepDetailsPanel
            step={currentStep}
            stepIndex={timeline.currentStepIndex}
            totalSteps={schema.trace.length}
            codePreview={codePreview.codePreview}
            isCodePreviewLoading={codePreview.isLoading}
            codePreviewError={codePreview.errorMessage}
          />
        </aside>
      </main>
    </div>
  );
}

export default App;
