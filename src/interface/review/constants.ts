import type { ReviewTabOption } from "./types.ts";

export const REVIEW_TABS: readonly ReviewTabOption[] = [
  { id: "overview", label: "Overview" },
  { id: "files", label: "Files" },
  { id: "summary", label: "Summary" },
  { id: "standards", label: "Standards" },
];

export const DEFAULT_LOAD_REQUEST = {
  repositoryPath: ".",
  commitSha: "HEAD",
};

export const DEFAULT_STANDARDS_RULE_TEXT = [
  "1. No any types in domain or application logic.",
  "2. Do not ship console.log statements in production code.",
  "3. Changes should include tests for critical workflows.",
  "4. Keep DDD dependency direction intact between layers.",
].join("\n");
