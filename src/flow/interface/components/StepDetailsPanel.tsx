import type { CodePreview, FlowStep } from "../types";

interface StepDetailsPanelProps {
  step: FlowStep | null;
  stepIndex: number;
  totalSteps: number;
  codePreview: CodePreview | null;
  isCodePreviewLoading: boolean;
  codePreviewError: string | null;
}

export function StepDetailsPanel(props: StepDetailsPanelProps): JSX.Element {
  const { step, stepIndex, totalSteps, codePreview, isCodePreviewLoading, codePreviewError } = props;

  if (step === null) {
    return (
      <section className="step-details">
        <h2 className="panel-title">Step Details</h2>
        <p className="placeholder">Load a schema with trace steps to inspect execution details.</p>
      </section>
    );
  }

  return (
    <section className="step-details">
      <h2 className="panel-title">Step Details</h2>
      <p className="step-kicker">
        Step {stepIndex + 1} of {totalSteps}
      </p>
      <h3>{step.title}</h3>
      {step.description !== undefined ? <p className="step-description">{step.description}</p> : null}

      <div className="tag-group">
        <p className="tag-label">Focused Nodes</p>
        <div className="tag-list">
          {step.focusNodeIds.length > 0 ? (
            step.focusNodeIds.map((nodeId) => (
              <span key={nodeId} className="tag">
                {nodeId}
              </span>
            ))
          ) : (
            <span className="tag tag--empty">None</span>
          )}
        </div>
      </div>

      <div className="tag-group">
        <p className="tag-label">Focused Edges</p>
        <div className="tag-list">
          {step.focusEdgeIds.length > 0 ? (
            step.focusEdgeIds.map((edgeId) => (
              <span key={edgeId} className="tag">
                {edgeId}
              </span>
            ))
          ) : (
            <span className="tag tag--empty">None</span>
          )}
        </div>
      </div>

      <div className="code-ref-block">
        <p className="tag-label">Code Reference</p>
        <pre className="code-ref">
          <code>
            {step.codeRef.path}:{step.codeRef.line}
          </code>
        </pre>
        {isCodePreviewLoading ? <p className="code-status">Loading code preview...</p> : null}
        {codePreviewError !== null ? <p className="code-status code-status--error">{codePreviewError}</p> : null}
        {codePreview !== null ? (
          <div className="code-preview" role="region" aria-label="Code preview">
            {codePreview.snippet.split("\n").map((line, index) => {
              const lineNumber = codePreview.startLine + index;
              const isFocusedLine = lineNumber === step.codeRef.line;

              return (
                <div key={lineNumber} className={`code-line ${isFocusedLine ? "code-line--focused" : ""}`}>
                  <span className="code-line-number">{lineNumber.toString().padStart(4, " ")}</span>
                  <span className="code-line-content">{line || " "}</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
