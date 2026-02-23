import type { ReviewLoadRequest, ReviewTabOption, SampleCommitPreset } from "./types.ts";

export const REVIEW_TABS: readonly ReviewTabOption[] = [
  { id: "summary", label: "Summary" },
  { id: "sequence", label: "Sequence" },
  { id: "files", label: "Files" },
  { id: "standards", label: "Standards" },
  { id: "commit", label: "Commit" },
];

export const DEFAULT_LOAD_REQUEST: ReviewLoadRequest = {
  repositoryPath: ".",
  commitSha: "HEAD",
};

export const SAMPLE_COMMIT_PRESETS: readonly SampleCommitPreset[] = [
  {
    id: "sample-head",
    label: "Review MVP bootstrap (HEAD)",
    repositoryPath: ".",
    commitSha: "HEAD",
  },
  {
    id: "sample-auth",
    label: "Auth hardening (a11ce5e7)",
    repositoryPath: "./apps/api",
    commitSha: "a11ce5e7",
  },
  {
    id: "sample-visuals",
    label: "Overview visuals (b7c4d9a2)",
    repositoryPath: "./apps/web",
    commitSha: "b7c4d9a2",
  },
  {
    id: "sample-standards",
    label: "Standards parser refresh (c0ffee42)",
    repositoryPath: ".",
    commitSha: "c0ffee42",
  },
];

export const DEFAULT_STANDARDS_RULE_TEXT = [
  "1. No any types in domain or application logic.",
  "2. Do not ship console.log statements in production code.",
  "3. Changes should include tests for critical workflows.",
  "4. Keep DDD dependency direction intact between layers.",
].join("\n");
