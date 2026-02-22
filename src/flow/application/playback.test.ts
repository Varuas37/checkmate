import { describe, expect, it } from "vitest";

import { clampStepIndex, getNextStepIndex, getPreviousStepIndex, stepBy } from "./playback";

describe("playback", () => {
  it("returns -1 when there are no steps", () => {
    expect(clampStepIndex(0, 0)).toBe(-1);
    expect(getNextStepIndex(1, 0)).toBe(-1);
    expect(getPreviousStepIndex(1, 0)).toBe(-1);
  });

  it("clamps indexes to valid step bounds", () => {
    expect(clampStepIndex(-5, 4)).toBe(0);
    expect(clampStepIndex(99, 4)).toBe(3);
    expect(clampStepIndex(2, 4)).toBe(2);
  });

  it("steps forward and backward with bounds", () => {
    expect(getNextStepIndex(0, 3)).toBe(1);
    expect(getNextStepIndex(2, 3)).toBe(2);
    expect(getPreviousStepIndex(2, 3)).toBe(1);
    expect(getPreviousStepIndex(0, 3)).toBe(0);
    expect(stepBy(1, 10, 3)).toBe(2);
    expect(stepBy(1, -10, 3)).toBe(0);
  });
});
