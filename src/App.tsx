import { useMemo, useState } from "react";
import type { ChangeEvent } from "react";

import "./App.css";

import { DiagramCanvas } from "./flow/interface/components/DiagramCanvas";
import { StepDetailsPanel } from "./flow/interface/components/StepDetailsPanel";
import { TimelineControls } from "./flow/interface/components/TimelineControls";
import { DEFAULT_FLOW_SCHEMA } from "./flow/interface/defaultSchema";
import { useCodePreview } from "./flow/interface/hooks/useCodePreview";
import { useTimeline } from "./flow/interface/hooks/useTimeline";
import {
  loadAgentWorkflowFromRepo,
  parseUploadedFlowSchema,
} from "./flow/interface/parserGateway";
import type { FlowSchema, ValidationIssue } from "./flow/interface/types";

const DEFAULT_REPO_PATH = "/Users/clawdia/Documents/Projects/clawdia";

function App(): JSX.Element {
  const [schema, setSchema] = useState<FlowSchema>(DEFAULT_FLOW_SCHEMA);
  const [validationErrors, setValidationErrors] = useState<ValidationIssue[]>([]);
  const [activeSource, setActiveSource] = useState("Built-in sample");
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isLoadingRepoWorkflow, setIsLoadingRepoWorkflow] = useState(false);
  const [analysisRepoPath, setAnalysisRepoPath] = useState(DEFAULT_REPO_PATH);
  const [codeRepoRoot, setCodeRepoRoot] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Upload a schema file to animate your own flow.");

  const timeline = useTimeline(schema.trace.length);
  const currentStep = schema.trace[timeline.currentStepIndex] ?? null;
  const codePreview = useCodePreview(currentStep?.codeRef ?? null, codeRepoRoot);

  const focusedNodeIds = useMemo(() => {
    return new Set(currentStep?.focusNodeIds ?? []);
  }, [currentStep]);

  const focusedEdgeIds = useMemo(() => {
    return new Set(currentStep?.focusEdgeIds ?? []);
  }, [currentStep]);

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
    setActiveSource(`${loadResult.source} (${loadResult.repoRoot})`);
    timeline.reset(0);
    setStatusMessage(
      `Loaded ${loadResult.value.trace.length} workflow steps from ${loadResult.repoRoot}.`,
    );
    setIsLoadingRepoWorkflow(false);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="title-group">
          <p className="app-kicker">Easy Visualization MVP</p>
          <h1>Flow Animation Workspace</h1>
          <p className="app-subtitle">Upload a schema, inspect each step, and play the runtime trace.</p>
        </div>

        <div className="header-actions">
          <div className="repo-workflow-group">
            <label className="field-label" htmlFor="repo-path-input">
              Repo Path
            </label>
            <div className="repo-load-row">
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
                onClick={() => void handleLoadAgentWorkflow()}
                disabled={isLoadingRepoWorkflow}
              >
                {isLoadingRepoWorkflow ? "Analyzing..." : "Load Agent Workflow"}
              </button>
            </div>
          </div>

          <div className="upload-group">
            <label className="file-upload">
              <input
                type="file"
                accept=".json,application/json"
                onChange={handleFileUpload}
                disabled={isLoadingFile || isLoadingRepoWorkflow}
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
            <DiagramCanvas diagram={schema.diagram} focusedNodeIds={focusedNodeIds} focusedEdgeIds={focusedEdgeIds} />
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
                      <span className="step-nav-code">
                        {step.codeRef.path}:{step.codeRef.line}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </article>

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
