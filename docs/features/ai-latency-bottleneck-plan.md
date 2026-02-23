# AI Latency Bottleneck Reduction Plan

## Status
- Planning only.
- No implementation in this document.
- Focus is existing bottlenecks first.
- ACP integration is deferred until current pipeline is measured and improved.

## Goal
- Commit insights should be usable within 10 to 20 seconds in normal commits.
- Thread AI replies should feel responsive, with clear visibility into where time is spent.

## Current Suspected Bottlenecks
1. Per-file AI summaries are currently processed serially in the SDK path.
2. Standards analysis is run after commit analysis in many cases, extending wall-clock time.
3. Sequence generation can add a second long-running phase.
4. Thread replies route through the same publish path and may pay process startup + large prompt costs.
5. There is no end-to-end timing breakdown, so bottlenecks are inferred instead of measured.

## Success Metrics
1. Commit analysis `p50 <= 15s`, `p95 <= 25s` for common commit sizes.
2. Time to first useful AI content (file summaries or overview) `<= 10s` in p50.
3. Thread reply round-trip `p50 <= 8s`, `p95 <= 15s`.
4. Every analysis/thread run emits a timing timeline with per-step durations.

## Phase 0: Add Tracing First
1. Add a single trace ID per analysis run and per thread-reply run.
2. Capture start/end timestamps for these spans:
- `analyseCommitRequested` listener total.
- `resolveStandardsSource`.
- `commitAnalyser.analyseCommit` total.
- Per-file summary call duration and parse duration.
- Overview generation call duration and parse duration.
- Standards analyzer call duration.
- Sequence generation call duration.
- Tauri command timings for `run_cli_agent_prompt` and `run_claude_prompt`.
- Thread `askAgentDraftRequested` total and provider call duration.
3. Log target:
- Console in dev.
- Optional JSONL file in app data for session-level profiling.
4. Include context keys in each event:
- `traceId`, `commitId`, `fileCount`, `hunkCount`, `provider`, `mode` (`sdk` or `cli`), `model`, `status`, `durationMs`.

## Phase 1: Reduce Wall Time in Existing Workflow
1. Parallelize per-file summary calls with bounded concurrency.
- Replace serial per-file loop with a concurrency-limited pool.
- Suggested default concurrency: 3 or 4.
- Preserve deterministic output ordering.
2. Run standards analysis concurrently with commit analysis where safe.
- Start standards task early from the same commit context.
- Merge results when both complete.
- Keep existing fallback evaluator behavior.
3. Keep sequence generation decoupled.
- Continue to trigger only when sequence is missing.
- Trace it separately so it does not hide primary analysis latency.

## Phase 2: Optimize Thread Reply Latency
1. Add thread-specific traces around prompt assembly and provider call.
2. Reduce prompt size for thread replies:
- Keep only needed hunk context.
- Limit ancillary sections when not requested.
3. Add lightweight model path for thread replies.
- Prefer faster model profile for interactive thread Q and A.
- Preserve stricter mode only when explicitly requested.
4. Add queue rules:
- Ignore duplicate in-flight thread requests for same thread and same prompt hash.

## Phase 3: Caching and Reuse
1. Cache per-file summary results by commit SHA + file path + hunk fingerprint.
2. Reuse previously computed summaries when unchanged.
3. Store and trace cache hit ratio.

## Phase 4: ACP Evaluation (After Existing Bottlenecks)
1. Evaluate ACP client integration only after baseline + parallelization data is available.
2. Compare current CLI spawning vs ACP session-based transport for:
- Claude via `zed-industries/claude-agent-acp`.
- Codex CLI.
- Gemini CLI.
- Kiro CLI.
3. Gate ACP rollout behind provider-level feature flags.
4. Adopt only if measured latency and reliability improve over current path.

## Rollout Strategy
1. Ship tracing first behind a diagnostics flag.
2. Enable parallel per-file analysis behind a config flag.
3. Enable concurrent standards analysis behind a separate flag.
4. Monitor metrics for one full iteration before enabling by default.

## Risk Controls
1. Add concurrency caps to avoid provider rate-limit spikes.
2. Abort and cancellation must remain functional.
3. Keep deterministic ordering in UI and persisted cache.
4. Fail closed to current behavior when tracing or parallel branches fail.

## Definition of Done
1. Timing traces are visible and attributable to each pipeline stage.
2. Parallel per-file analysis is enabled and stable.
3. Median commit analysis meets 10 to 20 second target on normal commits.
4. Thread reply latency is measurably lower with no regression in response quality.
