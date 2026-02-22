import type { DiffOrientation } from "../../../domain/review/index.ts";

export function toggleDiffOrientation(current: DiffOrientation): DiffOrientation {
  return current === "split" ? "unified" : "split";
}
