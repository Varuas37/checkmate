# AI Analysis Lifecycle (Per-Commit, Cached, Background)

## Goal

Run AI analysis once per selected commit, cache the output by `repositoryPath + commitSha`, and reuse that cache across tabs (`Overview`, `Files`, `Summary`, `Standards`) without re-triggering analysis on tab switches.

This keeps the UI responsive, reduces unnecessary AI cost, and ensures standards + summaries stay consistent for a commit.

## What changed

1. Analysis is no longer tied to opening the `Summary` or `Standards` tab.
2. On `loadCommitReviewRequested`:
   - If cache exists, hydrate AI + standards from cache immediately.
   - If cache is missing, schedule one background analysis run for that commit.
3. A single analysis run now updates:
   - summary/overview/feature/file insights
   - standards checks/results
   - cache entry for future reuse
4. Manual refresh remains available and intentionally re-runs analysis.

## User workflow

1. User selects commit.
2. App loads commit diff data immediately.
3. Background AI starts (only if no cache for that commit).
4. User can navigate freely (`Files`, `Commit`, `Overview`, etc.) while placeholders render.
5. Once completed, all tabs read the same cached commit analysis.
6. If user re-opens the same commit later, cached data is used and analysis is not re-run automatically.

## Cache scope and shape

Cache key:

- `repositoryPath::commitSha`

Cached payload now includes:

- `overviewCards`
- `flowComparisons`
- `sequenceSteps`
- `fileSummaries`
- `standardsRules`
- `standardsResults`

Legacy cache entries without standards fields are still readable; they normalize to empty standards arrays.

## Standards behavior

Standards are generated in the same analysis lifecycle and persisted with commit analysis cache.

Standards view now includes a **Per-file Standards Marking** section:

- For each changed file, show pass/warn/fail counts linked from standards evidence.
- Display linked rule count for quick file-level triage.

## Loading and retry semantics

- Background generation drives existing loading placeholders.
- `Retry Standards Analysis` and `Refresh AI` still exist and trigger a full re-run intentionally.
- Tab navigation alone does not trigger re-analysis.

## Why this design

1. Cost control: avoid repeated AI calls caused by UI navigation.
2. Responsiveness: analysis runs in the background while diff navigation remains usable.
3. Consistency: all feature surfaces read one commit-scoped analysis artifact.
4. Extensibility: `AnalyseCommitInput` now carries standards metadata (`standardsRuleText`, `standardsSourcePath`) so the analyzer can evolve to a fully unified prompt path without changing UI/store contracts.
