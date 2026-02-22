# Agent Working Rules

## Mandatory Startup Sequence (No Exceptions)
1. Read `vision.md` first. If the canonical vision file is `docs/vision.md`, read that file first instead.
2. Read `coding_standards.md` second.
3. Read task-specific files third.
4. Confirm in the first progress update that this order was followed.

## Autonomous Execution Default
1. Execute tasks end-to-end until completion.
2. Do not pause for routine confirmations between normal steps (analysis, edits, tests, and docs updates).
3. Ask the user only when blocked by missing requirements, destructive/irreversible actions, or permission boundaries.
4. If requirements are ambiguous, choose the safest standards-compliant interpretation and continue, then record assumptions in handoff notes.

## Orchestration and Parallelism
1. Parallelize independent workstreams whenever it reduces turnaround time.
2. Use specialized agents/tools for focused subtasks when they improve quality or speed.
3. Keep one orchestrator responsible for cross-output consistency and final integration.
4. Never trade correctness, security, or boundary compliance for speed.

## Architecture and UI Guardrails
1. Preserve DDD dependency direction: `domain` -> `application` -> `infrastructure` -> `interface` -> `app`.
2. Keep business logic out of `interface` and framework concerns out of `domain`.
3. Preserve design-system consistency: token-driven styling, shared primitives/composed components first, and no ad-hoc visual variants without documented justification.
4. Default visual direction is minimal and low-chrome: avoid boxed/card-heavy layouts for launcher/startup surfaces unless a box is functionally required.

## Tooling Conventions
1. Use `yarn` as the package manager for install/run/update commands.
2. Avoid using `npm` commands unless explicitly requested for a one-off compatibility check.

## Conflict Handling
1. If a request conflicts with `coding_standards.md`, flag the conflict explicitly.
2. Provide a compliant alternative and proceed with it unless the user provides an explicit override.
3. Never silently bypass standards.

## Feature Completion: Commit Prompt (Mandatory)
When a feature, fix, or meaningful change is complete:
1. Identify all files touched **by that specific change** (do not bundle unrelated in-flight work).
2. Ask the user: "Ready to commit? I'll stage [list the specific files] for this change."
3. Wait for confirmation before staging or committing anything.
4. Stage only the identified files — never `git add .` or `git add -A`.
5. Write a focused commit message scoped to that feature (what changed and why).
6. Run `git status` after the commit to confirm clean staging area.

Do this every time a feature is finished. Do not skip it, do not defer it to a later session.

## Integration Handoff Notes (Required for Substantial Changes)
Keep handoff concise and actionable:
1. Scope: files/modules touched.
2. Contracts: APIs, events, schemas, and integration impact.
3. Integration steps: required downstream wiring or verification.
4. Validation: checks/tests run plus remaining risks or assumptions.


<!-- checkmate:tracking:start -->
## Checkmate Tracking (added by checkmate.sh)
- Preserve commit rationale and key decisions for each meaningful change.
- Include validation evidence (tests/checks) and any known risks.
- For AI-authored edits, keep a short "why this change exists" summary for reviewers.
<!-- checkmate:tracking:end -->

