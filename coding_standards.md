# Coding Standards

Date: 2026-02-22  
Status: Enforced

## 1) Mandatory Agent Workflow
1. Before any implementation work, read the vision document first (`vision.md` or `docs/vision.md`, whichever is canonical in this repo).
2. Read `coding_standards.md` second.
3. Read `committing_changes.md` third.
4. Start task-specific analysis and edits only after steps 1-3 are complete.
5. Execute tasks end-to-end by default. Do not stop for routine confirmations between normal implementation steps.
6. Ask for user confirmation only when blocked by missing requirements, destructive/irreversible actions, or explicit permission boundaries.
7. Parallelize independent subtasks and use specialized agents/tools when they materially improve quality or delivery time.
8. Keep one orchestrator responsible for final integration coherence and standards compliance.

## 2) Core Principle
This codebase uses strict DDD-inspired layering on frontend and backend.  
No change may bypass layer boundaries for convenience.

## 3) Required Stack (Frontend)
1. React + TypeScript.
2. Redux Toolkit for application state.
3. Tailwind CSS with token-driven design system.
4. Tauri 2.0 host for local filesystem/git/CLI access.

## 4) Architecture Model
Use bounded contexts (for example, `review`, `diff`, `comment`) with this dependency direction only:
1. `domain` -> no dependency on app/framework/infrastructure.
2. `application` -> depends on `domain`.
3. `infrastructure` -> implements `domain`/`application` ports and adapters.
4. `interface` -> presentation/UI only, consumes application APIs.
5. `app` -> composition/bootstrap only.

Forbidden:
1. Business logic in `interface`.
2. `domain` importing React/Redux/Tailwind/Tauri APIs.
3. Cross-context deep imports.
4. Dependency direction reversals for convenience.

## 5) Frontend Folder Baseline
```txt
src/
  app/
  domain/
  application/
  infrastructure/
  interface/
  design-system/
  shared/
```

Each context should maintain:
1. `domain`: entities/value objects/policies/ports.
2. `application`: use-cases, state orchestration, selectors.
3. `infrastructure`: API/repositories/persistence/adapters.
4. `interface`: containers, presentational components, routes.

## 6) Redux Rules
1. Use Redux Toolkit only (`createSlice`, `createEntityAdapter`, listener middleware, RTK Query).
2. Prefer RTK Query for server state.
3. Prefer listener middleware for workflow orchestration.
4. Use `createAsyncThunk` only when RTK Query/listener middleware does not fit.
5. Keep Redux state normalized (entity tables + IDs), avoid nested relational duplication.
6. Keep state serializable; no functions/class instances/Map/Set in store.
7. Use memoized selectors for derived data.
8. Action names should express domain events, not generic setters.

## 7) Logic vs Presentation Separation
1. Presentational components must receive data via props and emit callbacks via props.
2. Presentational components must not call APIs directly or own store mutation/orchestration logic.
3. Containers/hooks/use-cases manage fetching, orchestration, and command handling.
4. Complex branching and workflow logic must live outside JSX.

## 8) Design System + Tailwind Rules
1. No raw visual values in feature components (hex colors, ad-hoc spacing, one-off typography).
2. Use token-backed theme values only.
3. Maintain design system layers: `tokens`, `primitives`, `composed`, `shells`.
4. Reuse shared primitives/composed components before creating new variants.
5. Any unavoidable new variant must document why existing primitives/composed components are insufficient.
6. Visual language must stay minimal, consistent, and intentional across contexts.

## 9) TypeScript Requirements
1. `strict: true` is required.
2. Keep `noUncheckedIndexedAccess` enabled.
3. Keep `exactOptionalPropertyTypes` enabled.
4. No `any` in `domain` or `application` layers.
5. Prefer explicit public types at module boundaries.

## 10) Testing Requirements
1. Reducers/selectors/use-cases require unit tests.
2. Bug fixes require regression tests.
3. Critical review workflows require integration tests.
4. Tests must validate behavior, not implementation trivia.

## 11) Documentation Rules
1. Update the vision doc (`vision.md` or `docs/vision.md`) when architecture or product direction changes.
2. Document new boundaries and ports when introducing contexts.
3. If a rule exception is needed, document reason and expiry condition in the PR.
4. Keep `AGENT.md` and `coding_standards.md` aligned when execution rules change.

## 12) Integration Handoff Notes (Mandatory for Non-Trivial Changes)
Every substantial delivery must include concise handoff notes:
1. Scope: files/modules/contexts touched.
2. Contracts: APIs/events/schemas changed and downstream impact.
3. Integration actions: what another contributor must wire, migrate, or verify.
4. Validation: tests/checks run and remaining risks/assumptions.

## 13) Anti-Patterns (Do Not Introduce)
1. UI components directly calling remote APIs.
2. Random `useEffect` data fetching where RTK Query should be used.
3. A "god slice" containing unrelated domains.
4. Theme drift through one-off styles.
5. Cross-layer imports that violate boundaries.
6. Massive files with mixed concerns.
7. Serial execution of obviously independent subtasks when parallel orchestration is feasible.

## 14) PR Checklist (Mandatory)
1. Which bounded context(s) changed?
2. Are DDD layer boundaries and dependency direction preserved?
3. Are logic and presentation clearly separated?
4. Are Redux changes normalized and serializable?
5. Are design-system primitives/composed components reused consistently?
6. Were tests, handoff notes, and docs updated?

## 15) Commit Workflow (Mandatory)
1. Follow `committing_changes.md` as the source of truth for commit planning, staging, messaging, validation evidence, and merge hygiene.
2. After each meaningful change, identify only the files/hunks belonging to that scope.
3. Ask the user to confirm before committing and list exact staged files.
4. Stage only scoped files/hunks; never stage unrelated in-flight work.
5. Verify staging with `git status` and `git diff --staged` before commit.

**Never skip this step. Never defer it across sessions.**
Mixed-scope uncommitted work causes incorrect diffs, lost context, and unstable review quality.
