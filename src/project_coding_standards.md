# Project Coding Standards

Use these standards as the default quality baseline for commit reviews when a project-specific standards file is not configured.

1. Follow SOLID principles and keep responsibilities focused per module.
2. Keep domain and application layers free of infrastructure dependencies (dependency direction inward only).
3. Prefer composition over inheritance unless inheritance is clearly justified.
4. Avoid duplicated logic; extract reusable units when behavior repeats.
5. Keep functions small, deterministic, and easy to test.
6. Validate all external input at boundaries and fail with explicit errors.
7. Never log secrets, tokens, or PII; redact sensitive values in logs and errors.
8. Handle errors with actionable messages and avoid swallowing exceptions.
9. Add or update tests for behavior changes, especially critical workflows and regressions.
10. Keep naming explicit and intention-revealing; avoid ambiguous abbreviations.
11. Keep changes cohesive: each commit should have a clear, single reviewable intent.
12. Limit public API surface; keep internals private unless external access is required.
13. Use type-safe contracts and avoid `any` or unsafe casts unless strictly necessary.
14. Prefer immutable data flow and explicit state transitions over hidden mutation.
15. Document non-obvious tradeoffs, constraints, and security considerations in code or docs.
