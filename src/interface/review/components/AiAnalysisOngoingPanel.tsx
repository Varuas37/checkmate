import { cn } from "../../../shared/index.ts";

export interface AiAnalysisOngoingPanelProps {
  readonly className?: string;
  readonly title?: string;
  readonly description?: string;
  readonly showNotificationHint?: boolean;
}

const DEFAULT_TITLE = "AI analysis is running";
const DEFAULT_DESCRIPTION =
  "We are generating the commit review in the background. Keep reviewing the diff and return once the run finishes.";

const stageCardClass =
  "rounded-sm border border-border/60 bg-canvas/50 px-3 py-2.5";

export function AiAnalysisOngoingPanel({
  className,
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  showNotificationHint = false,
}: AiAnalysisOngoingPanelProps) {
  return (
    <div className={cn("flex h-full items-center justify-center p-4", className)}>
      <section className="w-full max-w-3xl rounded-md border border-accent/20 bg-accent/5 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-accent animate-pulse" />
            <span className="h-2.5 w-2.5 rounded-full bg-accent/70 animate-pulse [animation-delay:160ms]" />
            <span className="h-2.5 w-2.5 rounded-full bg-accent/45 animate-pulse [animation-delay:320ms]" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-accent">AI Analysis</p>
            <h2 className="font-display text-lg font-semibold tracking-tight text-text">{title}</h2>
          </div>
        </div>

        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">{description}</p>

        <div className="mt-4 grid gap-2 md:grid-cols-3">
          <div className={stageCardClass}>
            <p className="text-[11px] uppercase tracking-[0.1em] text-muted">Step 1</p>
            <p className="mt-1 text-sm font-medium text-text">Summaries first</p>
            <p className="mt-1 text-xs leading-5 text-muted">Collecting commit and file-level review notes.</p>
          </div>
          <div className={stageCardClass}>
            <p className="text-[11px] uppercase tracking-[0.1em] text-muted">Step 2</p>
            <p className="mt-1 text-sm font-medium text-text">Sequence in parallel</p>
            <p className="mt-1 text-xs leading-5 text-muted">Building the code-flow diagram while analysis continues.</p>
          </div>
          <div className={stageCardClass}>
            <p className="text-[11px] uppercase tracking-[0.1em] text-muted">Step 3</p>
            <p className="mt-1 text-sm font-medium text-text">Standards last</p>
            <p className="mt-1 text-xs leading-5 text-muted">Running coding-standards checks after the main review is ready.</p>
          </div>
        </div>

        {showNotificationHint && (
          <p className="mt-4 text-xs text-muted">
            If desktop notifications are enabled, you will get a notification when the review is ready.
          </p>
        )}
      </section>
    </div>
  );
}
