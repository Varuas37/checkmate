# Frontend Design Principles

Date: 2026-02-22  
Status: Enforced for new UI work

## 1) Visual Direction
1. Prioritize a focused, tool-like interface over dashboard-style panels.
2. Keep startup and navigation surfaces command-centric: list actions first, forms second.
3. Use restrained accent color usage for primary actions and focus states only.
4. Favor dense but readable typography with clear hierarchy (`font-display` for headings, `font-mono` for command/meta, `font-body` for content).
5. Keep a minimal look by default: no decorative containers, heavy card stacks, or persistent boxed wrappers unless required by function.

## 2) Home/Launcher Screens
1. Use a centered, narrow launcher composition with minimal chrome.
2. Group actions under section headers with thin separators (`Get Started`, `Recent Projects`, etc.).
3. Represent primary actions as rows with left label/detail and right-aligned shortcut/hint text.
4. Keep setup inputs compact, understated, and secondary to action rows.
5. Preserve one-click path from launcher to active review workspace.

## 3) Workspace Screens
1. Keep diffs as the dominant visual element.
2. Minimize non-essential chrome and avoid large decorative blocks.
3. Keep comments and review affordances contextual to code locations.
4. Maintain consistent spacing and border rhythm across tabs and panels.

## 4) Interaction Rules
1. Keyboard cues should be visible where actions are frequent.
2. Hover/focus states must be subtle but clear (token-based borders/background shifts).
3. Error and validation messages should be inline, concise, and near relevant controls.

## 5) Implementation Constraints
1. Use token-backed Tailwind values only; no ad-hoc color/spacing literals.
2. Reuse design-system primitives/composed components when possible.
3. Introduce custom visual patterns only when existing primitives cannot express the interaction.
4. Keep presentational logic inside interface components and business orchestration in containers/hooks.
