import { useCallback, useEffect, useState } from "react";
import { clampStepIndex, getNextStepIndex, getPreviousStepIndex } from "../../application";

interface UseTimelineResult {
  currentStepIndex: number;
  isPlaying: boolean;
  speed: number;
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  goTo: (index: number) => void;
  reset: (index?: number) => void;
  setSpeed: (value: number) => void;
}

export function useTimeline(totalSteps: number): UseTimelineResult {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeedState] = useState(1);

  useEffect(() => {
    if (totalSteps <= 0) {
      setCurrentStepIndex(0);
      setIsPlaying(false);
      return;
    }

    setCurrentStepIndex((previous) => normalizeStepIndex(clampStepIndex(previous, totalSteps)));
  }, [totalSteps]);

  useEffect(() => {
    if (!isPlaying || totalSteps <= 1) {
      return;
    }

    const intervalMs = Math.max(220, Math.round(1000 / speed));
    const timerId = window.setInterval(() => {
      setCurrentStepIndex((previous) => {
        const nextStep = normalizeStepIndex(getNextStepIndex(previous, totalSteps));
        if (nextStep === previous) {
          setIsPlaying(false);
          return previous;
        }

        return nextStep;
      });
    }, intervalMs);

    return () => {
      window.clearInterval(timerId);
    };
  }, [isPlaying, speed, totalSteps]);

  const play = useCallback(() => {
    if (totalSteps > 0) {
      setIsPlaying(true);
    }
  }, [totalSteps]);

  const pause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const next = useCallback(() => {
    setCurrentStepIndex((previous) => {
      if (totalSteps === 0) {
        return 0;
      }

      return normalizeStepIndex(getNextStepIndex(previous, totalSteps));
    });
  }, [totalSteps]);

  const previous = useCallback(() => {
    setCurrentStepIndex((previousIndex) => normalizeStepIndex(getPreviousStepIndex(previousIndex, totalSteps)));
  }, [totalSteps]);

  const goTo = useCallback((index: number) => {
    setCurrentStepIndex(normalizeStepIndex(clampStepIndex(index, totalSteps)));
    setIsPlaying(false);
  }, [totalSteps]);

  const reset = useCallback((index = 0) => {
    setCurrentStepIndex(normalizeStepIndex(clampStepIndex(index, totalSteps)));
    setIsPlaying(false);
  }, [totalSteps]);

  const setSpeed = useCallback((value: number) => {
    const clampedValue = Math.max(0.25, Math.min(4, value));
    setSpeedState(clampedValue);
  }, []);

  return {
    currentStepIndex,
    isPlaying,
    speed,
    play,
    pause,
    next,
    previous,
    goTo,
    reset,
    setSpeed,
  };
}

function normalizeStepIndex(value: number): number {
  return value < 0 ? 0 : value;
}
