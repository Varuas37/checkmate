# Agent Operating Guide

## Mandatory First Step
Before starting any task, read `docs/vision.md`.

If a requested change conflicts with `docs/vision.md`, do not proceed silently:
1. Call out the conflict.
2. Propose an explicit vision update or a scoped exception.

## Required Reading Order
1. `docs/vision.md`
2. `coding_standards.md`
3. Task-specific files

## Execution Rules
1. Keep changes aligned to the MVP and avoid unrelated scope.
2. Prefer simple solutions that preserve responsiveness and clarity.
3. Maintain schema compatibility unless a version bump is documented.
4. Add or update tests for behavior changes.
5. Keep docs current when changing architecture, schema, or workflow.

## Deliverable Format For Agent Work
Every substantial change should include:
1. What changed.
2. Why it changed.
3. Bounded context(s) touched.
4. Tests added/updated.
5. Any follow-up tasks.

## Diagram/Trace Discipline
When a feature impacts runtime flow, update the dogfood scenario and related trace schema so the app can explain itself.
