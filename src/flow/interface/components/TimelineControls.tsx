const SPEED_OPTIONS = [0.5, 1, 1.5, 2] as const;

interface TimelineControlsProps {
  currentStepIndex: number;
  totalSteps: number;
  isPlaying: boolean;
  speed: number;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSpeedChange: (speed: number) => void;
}

export function TimelineControls(props: TimelineControlsProps): JSX.Element {
  const {
    currentStepIndex,
    totalSteps,
    isPlaying,
    speed,
    onPlay,
    onPause,
    onNext,
    onPrevious,
    onSpeedChange,
  } = props;

  const isAtStart = currentStepIndex <= 0;
  const isAtEnd = totalSteps === 0 || currentStepIndex >= totalSteps - 1;
  const progressPercent = totalSteps <= 1 ? 0 : (currentStepIndex / (totalSteps - 1)) * 100;

  return (
    <div className="timeline-controls">
      <div className="timeline-row">
        <button type="button" className="control-btn" onClick={onPrevious} disabled={isAtStart || totalSteps === 0}>
          Previous
        </button>
        <button type="button" className="control-btn control-btn--accent" onClick={onPlay} disabled={isPlaying || totalSteps === 0}>
          Play
        </button>
        <button type="button" className="control-btn" onClick={onPause} disabled={!isPlaying}>
          Pause
        </button>
        <button type="button" className="control-btn" onClick={onNext} disabled={isAtEnd}>
          Next
        </button>
      </div>

      <div className="speed-group">
        <span className="speed-label">Speed</span>
        {SPEED_OPTIONS.map((option) => {
          const isActive = Math.abs(speed - option) < 0.001;
          return (
            <button
              key={option}
              type="button"
              className={`speed-btn ${isActive ? "speed-btn--active" : ""}`}
              onClick={() => onSpeedChange(option)}
            >
              {option}x
            </button>
          );
        })}
      </div>

      <div className="timeline-progress" aria-hidden="true">
        <div className="timeline-progress-fill" style={{ width: `${progressPercent}%` }} />
      </div>

      <div className="timeline-meta">
        <span>
          Step {totalSteps === 0 ? 0 : currentStepIndex + 1} / {totalSteps}
        </span>
        <span>{isPlaying ? "Playing" : "Paused"}</span>
      </div>
    </div>
  );
}

