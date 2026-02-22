# CodeLens Vision

Date: 2026-02-22  
Status: Draft v2 (UI direction refresh)

## 1) North Star
Build the most efficient review surface for AI-generated commits: minimal chrome, diff clarity first, and fast human+agent feedback loops.

## 2) Problem We Solve
AI coding tools can generate very large diffs quickly. Tests can pass, but reviewers still struggle to answer:
1. What changed exactly?
2. Why did it change?
3. Is the design still sound?
4. Are there unintended side effects?
5. How do we send precise feedback back into the agent loop?

## 3) Product Thesis
Code reviews become dramatically better when we combine:
1. Traditional file diffs as the primary canvas.
2. AI-generated commit context (overview, summaries, diagrams).
3. Strong workflow guidance (`Overview` -> `Files` -> `Summary` -> `Standards`).
4. Standards validation from editable `coding_standards.md`.
5. Two-way agent collaboration (comments/questions -> agent -> patch suggestions).

## 4) Platform Decision (Browser vs Desktop)
### Direct Answer
Primary product should be **Tauri 2.0 + React** desktop app.

### Why Browser-Only Is Limited
1. Browsers cannot freely read/write arbitrary local files without user grants.
2. File System Access API support is not uniform and has permission friction.
3. Running local git/CLI workflows continuously is constrained.
4. Tight integration with local coding agents and command execution is harder.

### Desktop Benefits
1. Full local repo access through controlled backend commands.
2. Reliable git operations and commit browsing.
3. Safer local execution model with explicit capability boundaries.
4. Better foundation for agent-loop automation.

Optional future mode: web viewer (read-only or limited mode).

## 5) Users
1. Engineers reviewing AI-generated PRs.
2. Tech leads validating architecture and standards.
3. Human + AI pair-review workflows in fast-moving codebases.

## 6) UI Direction (Reference Screenshots)
1. Minimal CodeLens-like review surface: low visual noise, high content density, and no decorative panels competing with diffs.
2. Strong review workflow: `Overview`, `Files`, `Summary`, `Standards` are first-class and always discoverable.
3. Right changed-files rail: persistent file list with per-file churn stats and quick filter/search.
4. Diff-first UX: selecting a file immediately opens code diff context; secondary insights are linked from diff state.
5. AI per-commit diagrams: generate both before/after architectural flow and code-level sequence diagrams per commit.
6. Theme support now: ship dark/light themes with tokenized design foundations so additional themes can be added later without rework.

## 7) Core UX Information Architecture
Main review workflow tabs:
1. `Overview`
2. `Files`
3. `Summary`
4. `Standards`

Persistent right rail:
1. Changed file list (grouping, filter, search).
2. Additions/deletions by file.
3. Quick jump to first unresolved discussion.

Primary canvas behavior:
1. Diff view is default entry point for file-level understanding.
2. Workflow tabs annotate the same commit state instead of creating disconnected views.

## 8) Core Review Experience
### Overview
1. AI change summary card for commit intent.
2. Change impact cards by area (auth, middleware, DB, UI, etc.).
3. Before/after architecture flow view generated per commit.
4. Before/after code-level sequence diagram generated per commit.
5. Click-through links from nodes/edges to relevant files and hunks.

### Files
1. Diff-first experience with immediate file open from right rail.
2. Vertical/horizontal split modes.
3. Inline comments on code ranges.
4. Threaded discussion with humans and agents.

### Summary
1. File-by-file AI summary.
2. Commit-level narrative.
3. Explicit risks, assumptions, and open questions.

### Standards
1. Load and parse `coding_standards.md`.
2. Show pass/warn/fail checks.
3. Explain evidence with file references.
4. Editable/customizable rules per repo.

## 9) Click-Through Interaction Model
Everything should be clickable and connected:
1. Click graph component -> filter related files.
2. Click sequence node/edge -> jump to matching diff hunk.
3. Click changed file -> auto-sync overview highlights.
4. Click comment thread -> context opens in diff and code snippet.

## 10) Agentic Collaboration Loop
### Authoring Feedback
1. Reviewer writes comments/questions on code blocks.
2. Reviewer can request "ask agent" per thread.

### Publish/Finalize
1. On `Publish Review`, all structured feedback is packaged.
2. Package is sent to chosen agent backend.
3. Agent returns analysis, proposed patch, or follow-up questions.

### Multi-Agent Tool Compatibility (Claude Code, Codex CLI, Gemini CLI)
1. Define one internal `Agent Bridge Protocol` (ABP) for requests/responses.
2. Implement adapters per tool:
   - `claude-code-adapter`
   - `codex-cli-adapter`
   - `gemini-cli-adapter`
3. Prefer native APIs when available for reliability.
4. Support CLI adapters through controlled subprocess bridges when needed.

## 11) Proposed Technical Architecture
### Frontend
1. React + TypeScript + Redux Toolkit.
2. Tailwind CSS with token-driven design system.
3. Diff-focused layout with persistent changed-files rail.
4. Theme system: dark/light now, extensible theme tokens later.

### Desktop Shell
1. Tauri 2.0.
2. Rust commands for secure local filesystem + git + process execution.
3. Capability/allowlist model for least privilege by default.

### Review Engine
1. Commit ingestion (`git log`, `git show`, patch parsing).
2. File-level and area-level summarization.
3. AI diagram builders per commit:
   - before/after architecture flow
   - before/after code-level sequence
4. Standards evaluator.

### Agent Gateway
1. ABP request queue.
2. Adapter routing (Claude/Codex/Gemini/other).
3. Threaded response storage and citation links to code regions.

## 12) Data Model (High-Level)
1. `ReviewSession`: repo, branch, commit range, reviewers.
2. `CommitReview`: metadata, changed files, summaries, diagrams.
3. `ChangedFile`: hunks, comments, AI notes, status.
4. `DiagramNode/Edge`: mapped links to files/hunks.
5. `ReviewThread`: comment messages + agent messages.
6. `StandardsResult`: rule checks + evidence.

## 13) MVP Scope (First Production-Oriented Pass)
1. Open local git repo.
2. Select commit (or commit range).
3. Show persistent right changed-file rail with filter/search.
4. Diff viewer with vertical/horizontal toggle (default file-open behavior).
5. Overview tab with AI-generated before/after architecture and code-level sequence diagrams per commit.
6. AI summaries:
   - per file
   - whole commit
7. Standards checks from editable `coding_standards.md`.
8. Comment threads with "ask agent" support.
9. Dark/light themes with tokenized implementation for future theme expansion.
10. Publish review package to one agent adapter (first: Claude Code or Codex).

## 14) Out of Scope for MVP
1. Real-time multi-user collaboration.
2. Full semantic program analysis for all languages.
3. Perfect architecture inference for huge monorepos.
4. Cloud-hosted execution by default.

## 15) Milestones
1. `M1`: Repository + commit ingestion, diff foundation, right rail.
2. `M2`: Overview visuals + before/after architecture and sequence diagrams.
3. `M3`: AI summaries + standards tab + workflow polish.
4. `M4`: Comment threads + agent bridge publish loop.
5. `M5`: Security hardening, performance, and production packaging.

## 16) Success Metrics
1. Reviewer reaches accurate understanding of a large AI diff in < 10 minutes.
2. Time-to-first-actionable-comment reduced by at least 40%.
3. Standards violations surfaced with high precision.
4. Feedback-to-agent loop completes in one click from finalized review.

## 17) Risks and Mitigations
1. Risk: noisy AI summaries.
   Mitigation: require source-grounded evidence + file links.
2. Risk: misleading AI diagrams.
   Mitigation: show confidence and direct links to exact hunks.
3. Risk: tool integration fragility.
   Mitigation: ABP adapter boundary + retries + clear error states.
4. Risk: security concerns with local command execution.
   Mitigation: strict allowlists, permission prompts, and audit logs.

## 18) Immediate Next Steps
1. Finalize ABP schema for agent adapters.
2. Define `coding_standards.md` default rule format.
3. Implement Tauri 2.0 shell command stubs for commit listing and diff retrieval.
4. Implement the workflow shell (`Overview`, `Files`, `Summary`, `Standards`) with diff-first navigation and right-rail sync.
