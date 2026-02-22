# Committing Changes Standard

Date: 2026-02-22  
Status: Enforced  
Applies to: Humans and agents operating in this repository

## 1) Purpose
This document defines how to turn fast, high-volume change streams into clean, reviewable, and reliable commits.

Primary outcomes:
1. Every commit has one clear intent.
2. Reviewers can understand and validate each commit quickly.
3. History stays bisectable and safe for rollbacks.
4. Agent-generated work remains attributable and auditable.

## 2) Research-Backed Foundations
The policy below is based on established practices and evidence:
1. Keep changes logically separated and avoid mixing unrelated modifications in one patch/commit [R1].
2. Keep each commit in a state that can be validated independently (build/tests) to preserve bisectability [R1][R11].
3. Smaller review units produce better reviewer throughput and lower cognitive load [R2][R3][R4].
4. Use disciplined commit messages (short subject + explanatory body) [R5].
5. Use selective staging and patch splitting (`git add -p`) to form atomic commits [R6].
6. Use fixup + autosquash for cleanup before merge (`git commit --fixup`, `git rebase --autosquash`) [R5][R7].
7. Use commit metadata trailers for machine-readable automation context [R8].
8. Enforce policy with hooks, protected branches, and merge queues [R9][R12][R13].
9. Use commit signature verification and provenance controls where possible [R14][R19].

## 3) Core Definitions
1. `Run`: One agent execution cycle (prompt -> edits -> response).
2. `Scope`: A logical unit of work expected to become one commit.
3. `Candidate commit`: A staged proposal containing files/hunks, message, validation evidence, and risk notes.
4. `Commit packet`: Commit message + trailers + validation details + scope metadata.

## 4) Non-Negotiable Policy
1. One commit must represent one reviewable intent.
2. Never bundle unrelated concerns in one commit (for example UI restyle + backend contract change + test harness refactor).
3. Stage explicitly by file/hunk. Never use blanket staging for mixed work.
4. Every commit must include validation evidence proportional to risk.
5. Commit message must explain why the change exists, not only what changed.
6. If a change cannot be explained in one short intent statement, split it.
7. If uncertainty exists about grouping, prefer smaller commits.

## 5) Size Guidance for High-Volume Agentic Work
These are repository policy targets, not git limitations:
1. Target commit size: <= 10 files and <= 400 changed lines.
2. Soft warning: > 10 files or > 400 changed lines.
3. Hard review gate: > 20 files requires explicit user approval for a single commit.
4. Large generated changes should be partitioned by behavior boundary, not by file type alone.

Rationale:
1. Review effectiveness degrades as change volume grows [R2][R3][R4].
2. Smaller commits improve revert safety and debugging speed.

## 6) Commit Message Standard
Use this format by default:

```txt
<type>(<scope>): <imperative subject>

Why:
- <problem or risk being addressed>

What:
- <key behavioral changes>

Validation:
- <tests/checks run>

Scope-Id: <scope_id>
Run-Ids: <run_id_1>,<run_id_2>
Risk: <low|medium|high>
```

Rules:
1. Subject line should be concise (git recommends a short summary and common practice is around 50 characters) [R5].
2. Use imperative mood in subject.
3. Body explains intent and impact.
4. Prefer machine-readable trailers for automation [R8].

Recommended types:
1. `feat`
2. `fix`
3. `refactor`
4. `perf`
5. `test`
6. `docs`
7. `chore`

Conventional Commits syntax is recommended for consistency and automation [R10].

## 7) Mandatory Git-Native Workflow
For every commit:
1. Inspect all changes.
2. Define intended scope in one sentence.
3. Stage only matching hunks/files.
4. Verify staged diff.
5. Run validation.
6. Commit with structured message.
7. Confirm no unrelated staged content remains.

Reference command flow:

```bash
git status --porcelain
git diff --name-status

# Stage only what belongs to this scope
git add -p

# Verify exact staged payload
git diff --staged --stat
git diff --staged

# Validate
yarn test <relevant-tests>

# Commit
git commit

# Confirm staging hygiene
git status --short
```

Cleanup flow for follow-up fixes:

```bash
git commit --fixup <target_sha>
git rebase -i --autosquash <base_sha>
```

## 8) Agentic Workflow for High-Volume Changes
When many files are touched across multiple runs, use scope-first commits.

Per-run contract (before assistant response):
1. Record `core_issue`.
2. Record changed files and line-level hunks.
3. Link run to an existing scope (last 60 minutes) or create a new scope.
4. Emit a short scope update in the response.

This avoids 35-file mixed commits and keeps in-flight work partitioned.

Implementation note:
1. Detailed scope storage and pre-commit UX design lives in `docs/features/pre-commit.md`.

## 9) Deterministic Line Tracking (Same File Across Multiple Runs)
Raw line numbers are unstable because later edits can shift earlier hunks. Use blob-based tracking:
1. Capture `before_blob_oid` and `after_blob_oid` for each file change.
2. Parse hunks from deterministic diff settings.
3. Compute stable hunk identity from content + anchors.
4. When file changes again, remap prior hunks through blob-to-blob diff transform.
5. Classify each prior hunk state as:
   - `exact`
   - `shifted`
   - `overlapped`
   - `deleted`

Git is still the source of truth for file state; mapping logic is an overlay for stable scope ownership [R15].

## 10) `.cm` Design: Complement Git, Do Not Replace It
Git should remain canonical history and transport.

`.cm` should provide:
1. Scope tracking metadata.
2. Deterministic run logs.
3. Scope suggestion and commit planning UX.
4. Guardrails for staging only scoped changes.

Proposed command surface:
1. `cm scope start --run-id <id> --json`
2. `cm scope finish --run-id <id> --json`
3. `cm scope list --recent 60 --json`
4. `cm scope map --scope-id <id> --target WORKTREE --json`
5. `cm scope commit --scope-id <id> --message-file <path>`

Storage should remain repo-local under `.checkmate/` so history and metadata are inspectable and portable.

## 11) When Git Alone Is Enough vs When `.cm` Is Needed
Use git-only flow when:
1. Single run.
2. <= 8 files.
3. Clear single intent.

Use `.cm` overlay when:
1. Multi-run iterative work.
2. Same files edited repeatedly.
3. > 10 files touched.
4. Need deterministic scope-to-hunk traceability.

## 12) Example: Splitting a 35-File Working Tree
Scenario:
1. 35 changed files from rapid agent iterations.
2. Mixed concerns: UI shell, review data model, git adapter behavior, docs.

Good split:
1. Commit A `feat(review-ui): add pre-commit scope panel`  
   Files: only panel components + UI wiring.
2. Commit B `feat(scope-model): add run and scope entities`  
   Files: domain/application model and selectors.
3. Commit C `feat(git-adapter): capture deterministic hunk metadata`  
   Files: tauri/git adapter and schema updates.
4. Commit D `docs: add committing changes standard`  
   Files: docs only.

Bad split:
1. One 35-file commit with all concerns mixed.

## 13) Review and Merge Policy
1. Use protected branches for main integration [R12].
2. Require status checks before merge [R12].
3. Use merge queue for high-concurrency branches to reduce integration races [R13].
4. Require signed commits where policy demands identity/provenance guarantees [R14].

## 14) Enforcement and Automation
Use layered controls:
1. Local `commit-msg` hook: validate message structure and trailers [R9].
2. Local `pre-commit` hook: fast lint/type checks [R9].
3. CI: enforce tests and policy checks.
4. Merge controls: branch protection + merge queue [R12][R13].

## 15) Future-Ready Direction
1. Keep git as canonical DAG/history.
2. Add richer metadata and workflow orchestration in `.cm`.
3. Evaluate stacked-change workflows where useful:
   - Stacked PR patterns [R16]
   - Sapling stacked commits [R17]
   - Jujutsu operation-log and rewrite ergonomics [R18]
4. Add provenance/attestation integration for agent-generated artifacts [R19].

## 16) Operational Metrics
Track these per repo:
1. Median files per commit.
2. Median changed lines per commit.
3. Commit review turnaround time.
4. Revert rate by commit size bucket.
5. Percentage of commits with complete trailers and validation evidence.
6. Percentage of runs successfully mapped to scopes.

## 17) Quick Checklist (Before Commit)
1. Is this one clear intent?
2. Are unrelated hunks excluded?
3. Does the message explain why?
4. Did validation run?
5. Are scope/run trailers present for agent work?
6. Is reviewer load reasonable for this commit size?

## References
1. [R1] Linux kernel patch submission guidance: https://www.kernel.org/doc/html/latest/process/submitting-patches.html
2. [R2] Google Engineering Practices, Small CLs: https://google.github.io/eng-practices/review/developer/small-cls.html
3. [R3] Bosu et al., Characteristics of Useful Code Reviews (Microsoft study): https://www.researchgate.net/publication/281888306_Characteristics_of_Useful_Code_Reviews_An_Empirical_Study_at_Microsoft
4. [R4] Springer empirical study on review characteristics/outcomes: https://link.springer.com/article/10.1007/s10664-022-10247-5
5. [R5] Git commit manual (`git commit`): https://git-scm.com/docs/git-commit
6. [R6] Git add manual (`git add -p` interactive staging): https://git-scm.com/docs/git-add
7. [R7] Git rebase manual (`--autosquash`): https://git-scm.com/docs/git-rebase
8. [R8] Git trailers (`git interpret-trailers`): https://git-scm.com/docs/git-interpret-trailers
9. [R9] Git hooks (`commit-msg`, `pre-commit`): https://git-scm.com/docs/githooks
10. [R10] Conventional Commits 1.0.0: https://www.conventionalcommits.org/en/v1.0.0/
11. [R11] Git bisect manual: https://git-scm.com/docs/git-bisect
12. [R12] GitHub protected branches: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches
13. [R13] GitHub merge queue: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue
14. [R14] GitHub commit signature verification: https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification
15. [R15] Git patch identity (`git patch-id`): https://git-scm.com/docs/git-patch-id
16. [R16] Stacked PR workflow (Graphite): https://graphite.dev/guides/understanding-stacked-prs-git
17. [R17] Sapling SCM overview (stacked workflow context): https://sapling-scm.com/docs/overview/introduction/
18. [R18] Jujutsu documentation: https://jj-vcs.github.io/jj/latest/
19. [R19] SLSA provenance specification: https://slsa.dev/spec/v1.0/provenance
