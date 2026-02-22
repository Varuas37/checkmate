function normalizeStepCount(stepCount: number): number {
  if (!Number.isFinite(stepCount)) {
    return 0;
  }

  return Math.max(0, Math.trunc(stepCount));
}

function normalizeIndex(index: number): number {
  if (!Number.isFinite(index)) {
    return 0;
  }

  return Math.trunc(index);
}

export function clampStepIndex(index: number, stepCount: number): number {
  const normalizedStepCount = normalizeStepCount(stepCount);

  if (normalizedStepCount === 0) {
    return -1;
  }

  const normalizedIndex = normalizeIndex(index);

  if (normalizedIndex < 0) {
    return 0;
  }

  if (normalizedIndex >= normalizedStepCount) {
    return normalizedStepCount - 1;
  }

  return normalizedIndex;
}

export function getNextStepIndex(currentIndex: number, stepCount: number): number {
  return clampStepIndex(currentIndex + 1, stepCount);
}

export function getPreviousStepIndex(currentIndex: number, stepCount: number): number {
  return clampStepIndex(currentIndex - 1, stepCount);
}

export function stepBy(currentIndex: number, delta: number, stepCount: number): number {
  const normalizedDelta = Number.isFinite(delta) ? Math.trunc(delta) : 0;
  return clampStepIndex(currentIndex + normalizedDelta, stepCount);
}
