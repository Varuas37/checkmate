# Coding Standards

## Core Rule
This project follows Domain-Driven Design (DDD) strictly. No feature should bypass domain boundaries for short-term convenience.

## Architecture Boundaries
Use bounded contexts with clear ownership. Each context should follow:
1. `domain/`: entities, value objects, aggregates, domain services, domain events.
2. `application/`: use cases, orchestration, ports.
3. `infrastructure/`: adapters, persistence, file I/O, external systems.
4. `interface/`: UI/API layer and DTO mapping only.

Domain code must not import UI, framework, or persistence details.

## DDD Rules
1. Model business concepts using a shared ubiquitous language.
2. Protect invariants inside aggregates.
3. Use value objects for validated concepts, not primitive strings everywhere.
4. Keep use cases thin and explicit.
5. Keep side effects behind interfaces (ports), then implement adapters in infrastructure.

## TypeScript Standards (MVP)
1. `strict` mode required.
2. No `any` in domain and application layers.
3. Validate all untrusted input at boundaries (`zod` schemas).
4. Prefer named exports and explicit types for public APIs.
5. Keep functions small and deterministic where possible.

## Reliability and Bug Prevention
1. Every bug fix must include a regression test.
2. Domain invariants require unit tests.
3. Cross-context flows require integration tests.
4. Reject invalid schema references with clear error messages.
5. Fail fast on invalid state; do not silently continue.

## Performance Standards
1. Prioritize predictable performance over clever complexity.
2. Keep animation frame work minimal and avoid unnecessary re-renders.
3. Measure before optimizing; document hotspots.
4. Consider Rust/WASM only for proven bottlenecks.

## Simplicity Rules
1. Prefer boring, maintainable code over abstraction-heavy designs.
2. Do not introduce frameworks or patterns without clear need.
3. Remove dead code quickly.
4. Keep file/module responsibilities narrow and clear.

## Documentation Rules
1. Update `docs/vision.md` when product direction changes.
2. Document schema changes with version and migration notes.
3. Keep examples in sync with current behavior.

## Pull Request Checklist
1. Which bounded context is changed?
2. Are domain invariants still explicit and tested?
3. Are boundaries respected (no forbidden imports)?
4. Are schema and docs updated?
5. Is the change simple enough for a new contributor to follow?
