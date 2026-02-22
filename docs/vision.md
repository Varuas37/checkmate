# CodeLens Vision

Date: 2026-02-22  
Status: Draft v1 (fresh start)

## 1) North Star
Build the best code review tool for AI-generated changes: fast to understand, visually clear, and deeply integrated with human + agent collaboration.

## 2) Problem We Solve
AI coding tools can generate very large diffs quickly. Tests can pass, but reviewers still struggle to answer:
1. What changed exactly?
2. Why did it change?
3. Is the design still sound?
4. Are there unintended side effects?
5. How do we send precise feedback back into the agent loop?

## 3) Product Thesis
Code reviews become dramatically better when we combine:
1. Traditional file diffs.
2. Visual architecture + sequence representations.
3. AI summaries at file and commit level.
4. Standards validation from editable `coding_standards.md`.
5. Two-way agent collaboration (comments/questions -> agent -> patch suggestions).

## 4) Platform Decision (Browser vs Desktop)
### Direct Answer
Pure browser apps are limited for local file mutation and deep repo automation.

### Why Browser-Only Is Limited
1. Browsers cannot freely read/write arbitrary local files without user grants.
2. File System Access API support is not uniform and has permission friction.
3. Running local git/CLI workflows continuously is constrained.
4. Tight integration with local coding agents and command execution is harder.

### Decision
Primary product should be **Tauri 2.0 + React** desktop app.
1. Full local repo access via controlled backend commands.
2. Reliable git operations and commit browsing.
3. Safer local execution model.
4. Better foundation for agent-loop automation.

Optional future mode: web viewer (read-only or limited mode).

## 5) Users
1. Engineers reviewing AI-generated PRs.
2. Tech leads validating architecture and standards.
3. Human + AI pair-review workflows in fast-moving codebases.

## 6) Core UX Information Architecture
Main tabs:
1. `Overview`
2. `Files`
3. `Summary`
4. `Standards`

Persistent right sidebar:
1. Changed file list.
2. Additions/deletions by file.
3. Quick search/filter.

## 7) Core Review Experience
### Overview
1. AI change summary card.
2. Change impact cards by area (e.g., auth, middleware, DB, UI).
3. Architecture overview graph.
4. Before/after flow comparison.
5. Before/after sequence diagram.

### Files (Traditional PR Review)
1. Vertical/horizontal split diff modes.
2. Click file -> open diff immediately.
3. Inline comments on code ranges.
4. Threaded discussion with humans and agents.

### Summary
1. File-by-file AI summary.
2. Commit-level narrative.
3. Risks, assumptions, and open questions.

### Standards
1. Load and parse `coding_standards.md`.
2. Show pass/warn/fail checks.
3. Explain evidence with file references.
4. Editable/customizable rules per repo.

## 8) Click-Through Interaction Model
Everything should be clickable and connected:
1. Click graph component -> filter related files.
2. Click sequence node/edge -> jump to matching diff hunk.
3. Click changed file -> auto-sync overview highlights.
4. Click comment thread -> context opens in diff and code snippet.

## 9) Agentic Collaboration Loop
### Authoring Feedback
1. Reviewer writes comments/questions on code blocks.
2. Reviewer can request "ask agent" per thread.

### Publish/Finalize
1. On `Publish Review`, all structured feedback is packaged.
2. Package is sent to chosen agent backend.
3. Agent returns analysis, proposed patch, or follow-up questions.

### Multi-Agent Tool Compatibility (Claude Code, Codex CLI, Gemini CLI)
Best architecture:
1. Define one internal `Agent Bridge Protocol` (ABP) for requests/responses.
2. Implement adapters per tool:
   - `claude-code-adapter`
   - `codex-cli-adapter`
   - `gemini-cli-adapter`
3. Prefer native APIs when available for reliability.
4. Support CLI adapters through controlled subprocess bridges when needed.

This avoids tool lock-in and keeps the review UI stable.

### Repository Agent Execution Policy
1. Agents must read the vision doc first, then `coding_standards.md`, before implementation work.
2. Agents execute tasks to completion by default and avoid unnecessary confirmation prompts.
3. The orchestrator may parallelize independent work and use specialized agents/tools where beneficial.
4. All work must preserve DDD boundaries and design-system consistency.
5. Substantial deliveries must include concise integration handoff notes for downstream contributors.
6. Operational enforcement lives in `AGENT.md` and `coding_standards.md`.

## 10) Proposed Technical Architecture
### Frontend
1. React + TypeScript + Redux Toolkit.
2. Tailwind CSS with token-driven design system (primitives, composed components, shells).
3. Diff UI and visualization layer.
4. Local state + persisted review sessions.

### Desktop Shell
1. Tauri 2.0.
2. Rust commands for secure local filesystem + git + process execution.

### Review Engine
1. Commit ingestion (`git log`, `git show`, patch parsing).
2. File-level and area-level summarization.
3. Diagram builders:
   - architecture graph
   - sequence (before/after)
4. Standards evaluator.

### Agent Gateway
1. ABP request queue.
2. Adapter routing (Claude/Codex/Gemini/other).
3. Threaded response storage and citation links to code regions.

## 11) Data Model (High-Level)
1. `ReviewSession`: repo, branch, commit range, reviewers.
2. `CommitReview`: metadata, changed files, summaries, diagrams.
3. `ChangedFile`: hunks, comments, AI notes, status.
4. `DiagramNode/Edge`: mapped links to files/hunks.
5. `ReviewThread`: comment messages + agent messages.
6. `StandardsResult`: rule checks + evidence.

## 12) MVP Scope (Production-Oriented First Pass)
1. Open local git repo.
2. Select commit (or commit range).
3. Show changed file sidebar with filter/search.
4. Diff viewer with vertical/horizontal toggle.
5. Overview graph + simple before/after sequence diagram.
6. AI summaries:
   - per file
   - whole commit
7. Standards checks from editable `coding_standards.md`.
8. Comment threads with "ask agent" support.
9. Publish review package to one agent adapter (first: Claude Code or Codex).

## 13) Out of Scope for MVP
1. Real-time multi-user collaboration.
2. Full semantic program analysis for all languages.
3. Perfect architecture inference for huge monorepos.
4. Cloud-hosted execution by default.

## 14) Milestones
1. `M1`: Repository + commit ingestion, diff foundation, file sidebar.
2. `M2`: Overview visuals + sequence before/after v1.
3. `M3`: AI summaries and standards tab.
4. `M4`: Comment threads + agent bridge publish loop.
5. `M5`: Hardening, performance, and production packaging.

## 15) Success Metrics
1. Reviewer reaches accurate understanding of a large AI diff in < 10 minutes.
2. Time-to-first-actionable-comment reduced by at least 40%.
3. Standards violations surfaced with high precision.
4. Feedback-to-agent loop completes in one click from finalized review.

## 16) Risks and Mitigations
1. Risk: noisy AI summaries.
   Mitigation: require source-grounded evidence + file links.
2. Risk: misleading diagrams.
   Mitigation: show confidence and direct links to exact hunks.
3. Risk: tool integration fragility.
   Mitigation: ABP adapter boundary + retries + clear error states.
4. Risk: security concerns with local command execution.
   Mitigation: strict allowlists, permission prompts, and audit logs.

## 17) Immediate Next Steps
1. Finalize ABP schema for agent adapters.
2. Define `coding_standards.md` default rule format.
3. Implement MVP skeleton in Tauri 2.0 + React:
   - repo picker
   - commit list
   - diff pane
   - overview tab scaffold
   - standards tab scaffold
