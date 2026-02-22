# Easy Visualization Vision

Date: 2026-02-22
Status: Draft v0 (first pass)

## Mission
Make software flow and code logic easy to explain, trace, and review through simple animated architecture diagrams.

## Problem
AI-assisted code generation increases code volume and speed, but understanding system behavior is harder. Static docs and raw code are slow to read, and teams struggle to explain runtime flow clearly.

## Product Direction
Build a fast, simple app that renders a schema-driven architectural diagram and plays back logic as an animation timeline.

The app should answer:
1. What components exist?
2. How data/control moves between components?
3. In what order do steps execute?
4. Which code artifact implements each step?

## Guiding Principles
1. Explainability first: every animated step must map to explicit code references.
2. Schema-first: renderer consumes a versioned JSON schema; generation can be done by AI or scripts.
3. Deterministic playback: same schema always produces same animation.
4. Low-friction authoring: user can edit schema manually when needed.
5. Fast feedback: load diagram and start playback in seconds.

## MVP Scope
1. Load one schema file (JSON) describing nodes, edges, and trace steps.
2. Render a draw.io-like diagram (boxes + arrows) with labels.
3. Animate flow steps over time (highlight node/edge, show step metadata).
4. Provide timeline controls: play, pause, next, previous, speed.
5. Show code references per step (file path + line).
6. Basic validation for malformed schema with actionable errors.
7. Export/import schema files.
8. Dogfood on this project itself (first canonical example).
9. Provide one repository-driven workflow preset (agent workflow from real code) to prove end-to-end tracing on live codebases.

## Out of Scope (MVP)
1. Full draw.io import fidelity.
2. Real-time collaborative editing.
3. Auto-layout for large graphs.
4. IDE plugin integration.
5. Full static analysis for all languages.

## First-Pass Tech Choice
TypeScript-first for MVP speed:
1. Frontend: React + Vite + SVG renderer.
2. Validation: `zod` for schema parsing.
3. State: simple app store (no heavy framework).

Rust is reserved for a later optimization path:
1. Optional Rust/WASM playback engine for very large diagrams.
2. Optional Rust backend for heavy codebase analysis.

## Schema v0 (Concept)
```json
{
  "version": "0.1",
  "diagram": {
    "nodes": [
      { "id": "api", "label": "API Service", "x": 120, "y": 80 },
      { "id": "worker", "label": "Worker", "x": 420, "y": 80 }
    ],
    "edges": [
      { "id": "e1", "from": "api", "to": "worker", "label": "enqueue job" }
    ]
  },
  "trace": [
    {
      "id": "s1",
      "title": "Request received",
      "focusNodeIds": ["api"],
      "focusEdgeIds": [],
      "codeRef": { "path": "src/api/handler.ts", "line": 42 }
    },
    {
      "id": "s2",
      "title": "Job queued",
      "focusNodeIds": ["api", "worker"],
      "focusEdgeIds": ["e1"],
      "codeRef": { "path": "src/queue/publish.ts", "line": 18 }
    }
  ]
}
```

## Dogfooding Plan
1. Build the app while documenting its own architecture in `examples/self-hosted-flow.json`.
2. Use the app in design reviews before coding major features.
3. Require every significant feature to add or update at least one trace scenario.

## MVP Milestones
1. Milestone 1: schema, parser, and validation errors.
2. Milestone 2: static diagram rendering.
3. Milestone 3: timeline playback and highlights.
4. Milestone 4: code-reference panel and keyboard controls.
5. Milestone 5: dogfood scenario for this repo.

## Success Metrics (MVP)
1. New contributor can explain one core flow in under 10 minutes.
2. Flow playback remains responsive for 100 nodes / 200 edges / 200 steps.
3. Schema validation catches invalid references before render.
4. At least one real team workflow uses this app for code walkthroughs.

## Risks and Mitigations
1. Risk: schema becomes too complex.
   Mitigation: versioned schema and strict minimal required fields.
2. Risk: diagrams drift from code reality.
   Mitigation: add code references and review checklist for updates.
3. Risk: performance on bigger diagrams.
   Mitigation: keep renderer simple now, profile early, move hotspots to Rust/WASM if needed.

## Decision Log (Initial)
1. Choose TypeScript for MVP delivery speed and lower setup friction.
2. Keep architecture DDD-aligned to avoid spaghetti as the codebase grows.
3. Treat schema as product surface, not an internal detail.
