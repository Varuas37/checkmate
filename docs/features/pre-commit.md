# Pre-Commit Scope Management (HLD)

Date: 2026-02-22  
Status: Draft v1 (review before implementation)

## 1) Problem
AI-assisted development creates many changes quickly. A single session can leave 20-40 modified files, often across multiple intents. This causes:
1. Hard-to-review commits.
2. Mixed-scope commits.
3. Lost context on why each file changed.
4. Friction when deciding what to commit together.

## 2) Desired Behavior
1. After every agent run, before the agent responds, it must record:
   - the core issue it solved,
   - files it changed,
   - scope of change.
2. On the next run, the system should query recent work (last 60 minutes), decide if the new run belongs to an existing scope, or create a new scope.
3. Users should get a pre-commit review view with potential commit suggestions, changed files, and rationale.
4. Git commands should only run after explicit user approval.

## 3) Goals
1. Keep commit scopes small, coherent, and reviewable.
2. Make scope matching simple and deterministic in V1.
3. Persist enough metadata for auditability and future automation.
4. Support untracked files cleanly in commit suggestions.

## 4) Non-Goals (V1)
1. Fully automatic commits without user confirmation.
2. Perfect semantic grouping for all edge cases.
3. Hunk-level split/merge across scopes.

## 5) Core Model
### Agent Run
One assistant execution cycle (user prompt -> edits -> assistant response).

Required metadata:
1. `core_issue`
2. `files_changed[]`
3. `scope_decision` (`attach_existing` or `create_new`)
4. `scope_id`

### Commit Scope
A logical unit of work expected to become one commit.

Contains:
1. Scope title/summary.
2. Linked run IDs.
3. Aggregated file set.
4. Status (`open`, `ready`, `committed`, `abandoned`).

### Pre-Commit Suggestion
User-facing candidate commit generated from one open scope.

Includes:
1. Scope summary.
2. Proposed commit message.
3. Files to include.
4. Risk/conflict flags.

## 6) Storage Design (Simple V1)
Use repo-local JSON files under `.checkmate` to avoid introducing a DB in V1.

Paths:
1. `.checkmate/pre_commit/schema.json`
2. `.checkmate/pre_commit/runs/<run_id>.json`
3. `.checkmate/pre_commit/scopes/<scope_id>.json`
4. `.checkmate/pre_commit/index.json` (small pointer index for quick queries)

Why this is simplest:
1. Human-readable and debuggable.
2. Easy backup/versioning with repo files.
3. No migration-heavy dependency for MVP.

Compatibility with existing tracking:
1. Keep existing `.checkmate/commit_context/*.json` unchanged for commit-level rationale.
2. Add optional `scope_id` in commit-context payload only after a scope is committed.
3. This keeps run-time scope management separate from final committed metadata, while preserving a clear link between them.

## 7) Run Lifecycle (Must Happen Before Response)
1. Capture git snapshot at run end:
   - `git status --porcelain`
   - changed files (tracked + untracked)
2. Build run report payload (`core_issue`, `files_changed`, branch, timestamps, user prompt summary).
3. Query open scopes updated in the last 60 minutes.
4. Classify run into existing scope or new scope.
5. Persist run JSON + updated scope JSON.
6. Only then allow assistant response to user.

If persistence fails:
1. Assistant response should include an explicit warning that scope tracking failed.
2. Scope assignment for that run remains `unknown`.

## 8) Scope Matching Algorithm (V1)
Deterministic heuristic, no heavy model required.

Inputs:
1. `files_changed[]` for current run.
2. Open scopes in same repo+branch updated within 60 minutes.
3. Optional user override (`force_new_scope` or `force_scope_id`).

Decision:
1. If `force_scope_id` present and valid, attach there.
2. Else if `force_new_scope` present, create new scope.
3. Else compute file overlap score with each recent scope:
   - overlap ratio = `|intersection(current_files, scope_files)| / |current_files|`
4. Attach to best scope if overlap ratio >= `0.30`.
5. Otherwise create new scope.

Tie-breaker:
1. Choose most recently updated scope.

Rationale:
1. Fast and predictable.
2. Works well for file-based commit cohesion.
3. Easy to explain in UI.

### Optional Extension: Deterministic Line-Level Tracking (V1.1)
This is feasible and not excessive complexity if implemented as a two-step snapshot flow.

Proposed CLI contract:
1. `cm scope start --run-id <run_id> --json`
2. Agent performs edits.
3. `cm scope finish --run-id <run_id> --json`
4. `cm scope map --scope-id <scope_id> --target WORKTREE --json` (optional query for current hunk positions)

`finish` returns:
1. file-level `added/deleted` counts,
2. exact hunk ranges (`old_start`, `old_lines`, `new_start`, `new_lines`),
3. deterministic `patch_hash` for replay/audit,
4. `before_blob_oid` and `after_blob_oid` for stable remapping later.

Determinism rules:
1. Use a fixed diff mode (`--unified=0`, no color, no rename detection for hunk extraction).
2. Normalize line endings before hashing (`\n` canonicalization).
3. Hash normalized patch text with SHA-256.
4. Include only repo-local files with stable path normalization.
5. Persist git blob IDs (`hash-object -w`) for pre/post file snapshots.

Practical complexity:
1. Low for read-only extraction (store run metadata + parsed diff hunks).
2. Medium only if we add hunk-level reassign/move in UI.
3. Recommendation: ship file-level grouping first, then add line-level as a non-blocking enhancement.

### Handling Same-File Re-Edits and Line-Number Drift
Git can provide deterministic snapshots and diffs, but it does not provide stable hunk IDs for uncommitted iterative runs. We should use git as the source of truth for snapshots and apply a small deterministic remapping layer.

Deterministic model:
1. For each changed file in a run, store:
   - `before_blob_oid`
   - `after_blob_oid`
   - hunk list from `before -> after` diff (`--unified=0`)
2. For each hunk, store stable identity metadata:
   - `hunk_id = sha256(file_path + normalized_removed + normalized_added + anchor_before + anchor_after)`
   - `anchor_before` and `anchor_after` hashes (small context windows)
3. When a later run changes the same file, remap previous hunk ranges using blob transitions:
   - compute diff from previous `after_blob_oid` to current `before_blob_oid`
   - transform old line intervals through the edit script
   - mark each hunk as `shifted`, `overlapped`, `deleted`, or `exact`
4. Scope overlap for same file should prefer mapped line overlap over file-only overlap.

Why this works:
1. Insertions above a hunk only shift coordinates; transform keeps ownership stable.
2. Direct edits inside a prior hunk are detected as overlap, not new unrelated work.
3. Full deletion of a prior hunk is explicitly represented.

Important note:
1. Relying only on absolute line numbers is not sufficient.
2. Relying only on git diff is not sufficient for persistent run-level hunk identity.
3. Blob IDs + deterministic transforms give stable tracking with manageable complexity.

## 9) Proposed Command/API Surface
Tauri commands (new):
1. `record_agent_run(payload)`  
   Persists run, performs scope match, returns scope decision.
2. `list_recent_scopes(repo_path, within_minutes = 60)`  
   Returns open scopes sorted by `updated_at desc`.
3. `list_pre_commit_suggestions(repo_path)`  
   Returns open scopes with suggested commit messages and conflict flags.
4. `reassign_scope_files(scope_id, files[])`  
   Manual fix when user adjusts grouping.
5. `commit_scope(scope_id, commit_message, include_untracked)`  
   Runs `git add` + `git commit` after explicit confirmation.
6. `resolve_scope_line_map(scope_id, target_ref = "WORKTREE")`  
   Returns current mapped positions/status for stored hunks (`exact`, `shifted`, `overlapped`, `deleted`).

Frontend wrappers can live in `src/shared/desktopIntegration.ts`, similar to current tracking commands.

## 10) Data Contracts (Draft)
### AgentRunRecord
```json
{
  "schema_version": "checkmate.pre_commit.run.v1",
  "run_id": "run_20260222_133012_9f7e",
  "session_id": "codex_session_abc",
  "repo_path": "/path/to/repo",
  "branch": "feature/pre-commit",
  "created_at_iso": "2026-02-22T13:30:12Z",
  "user_prompt_summary": "Add scope tracking for agent runs",
  "core_issue": "No commit-scope boundaries across fast AI edits",
  "files_changed": ["src-tauri/src/lib.rs", "src/shared/desktopIntegration.ts"],
  "line_changes": [
    {
      "file": "src-tauri/src/lib.rs",
      "before_blob_oid": "b0f4b6b8b2f7d3c1d9a6...",
      "after_blob_oid": "6e0c7d4fb5ae9b2de481...",
      "added": 22,
      "deleted": 4,
      "hunks": [
        {
          "hunk_id": "hunk_2f7dd2d2",
          "old_start": 776,
          "old_lines": 0,
          "new_start": 776,
          "new_lines": 18,
          "anchor_before_hash": "sha256:6f4f...",
          "anchor_after_hash": "sha256:d92a...",
          "change_hash": "sha256:1ac7..."
        },
        {
          "hunk_id": "hunk_81708a13",
          "old_start": 831,
          "old_lines": 2,
          "new_start": 849,
          "new_lines": 8,
          "anchor_before_hash": "sha256:32cc...",
          "anchor_after_hash": "sha256:a13b...",
          "change_hash": "sha256:7e1f..."
        }
      ],
      "patch_hash": "sha256:2d5d0f0d7f6f8a5d9f3e..."
    }
  ],
  "scope_decision": "attach_existing",
  "scope_id": "scope_20260222_131900_5a1c",
  "scope_reason": "File overlap 0.67 with recent scope"
}
```

### CommitScopeRecord
```json
{
  "schema_version": "checkmate.pre_commit.scope.v1",
  "scope_id": "scope_20260222_131900_5a1c",
  "repo_path": "/path/to/repo",
  "branch": "feature/pre-commit",
  "status": "open",
  "title": "Track run-level scope metadata before response",
  "created_at_iso": "2026-02-22T13:19:00Z",
  "updated_at_iso": "2026-02-22T13:30:12Z",
  "run_ids": ["run_20260222_131900_a1", "run_20260222_133012_9f7e"],
  "files": ["src-tauri/src/lib.rs", "src/shared/desktopIntegration.ts"],
  "suggested_commit_message": "Add run-level scope tracking and pre-commit scope grouping",
  "risk_flags": ["untracked_files_present"]
}
```

## 11) User Workflow
1. User requests a change.
2. Agent edits files.
3. Before replying, agent records run metadata (`core_issue`, `files_changed`, scope).
4. User sees a short "Scope Update" block in the response.
5. Over multiple runs, related changes accumulate into one scope.
6. User opens Pre-Commit Review.
7. User reviews suggested scopes, adjusts file assignments if needed, then confirms commit.
8. System runs git commands only for approved scope(s).

### Response Block (Shown Every Run)
```md
### Scope Update
- Core issue: Missing commit boundaries for fast AI edits.
- Files changed: `src-tauri/src/lib.rs`, `src/shared/desktopIntegration.ts`
- Scope: `scope_20260222_131900_5a1c` (attached)
- Reason: 67% file overlap with recent scope (last 60 min)
```

## 12) Pre-Commit UX (Markdown Wireframe)
```md
# Pre-Commit Review
Repository: easy_visualization
Branch: feature/pre-commit
Working tree: 35 changed files (22 modified, 9 untracked, 4 deleted)

## Suggested Commits
| Scope ID | Title | Files | Last Updated | Risk |
|---|---|---:|---|---|
| scope_131900 | Track run-level metadata | 12 | 2m ago | untracked files |
| scope_125100 | Improve review tab layout | 8 | 35m ago | none |
| scope_120440 | Fix Tauri invoke error paths | 5 | 52m ago | mixed file ownership |

## Selected Scope: scope_131900
Proposed message:
`Add run-level scope tracking and pre-commit grouping`

Files:
- src-tauri/src/lib.rs
- src/shared/desktopIntegration.ts
- src/interface/review/components/SettingsPanel.tsx

Actions:
- [Review Diff]
- [Move Files]
- [Edit Message]
- [Commit Scope]
```

## 13) Conflict and Edge Handling
1. File appears in multiple scopes:
   - Mark `mixed_file_ownership`.
   - Require user to pick one scope before commit.
2. Large refactors with low overlap:
   - Auto-create new scope.
3. Untracked files:
   - Include in scope suggestions and flag explicitly.
4. Runs with no file changes:
   - Persist run as metadata-only; no scope mutation required.

## 14) Rollout Plan
### Phase 1: Tracking Backbone
1. Add run/scope storage and `record_agent_run`.
2. Enforce "record before response" in agent pipeline.
3. Render simple response-side "Scope Update".

### Phase 2: Pre-Commit Suggestions
1. Add `list_pre_commit_suggestions`.
2. Build pre-commit panel listing candidate scopes and files.
3. Add manual file reassignment API.

### Phase 3: Commit Execution
1. Add `commit_scope`.
2. Confirmation modal with exact file list + commit message preview.
3. Post-commit scope status transition to `committed`.

## 15) Acceptance Criteria (V1)
1. Every assistant run creates a persisted run record before response.
2. System can query related scopes from last 60 minutes.
3. At least 80% of consecutive related runs auto-group correctly by file overlap heuristic in internal testing.
4. User can review and commit a selected scope without manually staging all files.

## 16) Open Questions
1. Should the 60-minute window be user-configurable per project?
2. Should scope matching include optional semantic text similarity in V1.1?
3. Do we allow one-click "commit all ready scopes" or force one-by-one review first?
