# Menu Bar Customization Guide (Tauri + React)

This project uses a custom macOS-style top bar for project/branch controls, while keeping native traffic lights.

## 1. Goal

Use a custom in-app top bar (like Zed) with:
- project selector
- branch selector
- draggable empty area
- native traffic lights still visible

## 2. Tauri Window Configuration

Set the main window to overlay title style and hide native title text.

File: `src-tauri/tauri.conf.json`

```json
{
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "checkmate.sh",
        "width": 1280,
        "height": 820,
        "resizable": true,
        "decorations": true,
        "titleBarStyle": "Overlay",
        "hiddenTitle": true,
        "trafficLightPosition": { "x": 14, "y": 18 }
      }
    ]
  }
}
```

## 3. Allow Dragging Permission

If you use `data-tauri-drag-region`, Tauri must allow start dragging.

File: `src-tauri/capabilities/default.json`

```json
{
  "permissions": [
    "core:default",
    "dialog:default",
    "core:webview:allow-create-webview-window",
    "core:window:allow-create",
    "core:window:allow-set-title",
    "core:window:allow-start-dragging"
  ]
}
```

Without this, you get:
- `window.start_dragging not allowed`

## 4. Remove App Menu (macOS)

This project removes the app menu at startup:

File: `src-tauri/src/lib.rs`

```rust
.setup(|app| {
    #[cfg(target_os = "macos")]
    {
        app.remove_menu()?;
    }
    Ok(())
})
```

Note:
- This removes the app menu integration for the app.
- You cannot remove the OS-level macOS menu bar itself from an app process.

## 5. Custom Top Bar in React

Core structure:
- left: project/branch controls
- middle/right: drag region

File: `src/interface/review/containers/ReviewWorkspaceContainer.tsx`

```tsx
const windowBarLeftInsetClass = isMacOperatingSystem() ? "pl-[4.75rem]" : "pl-3";

<header className="bg-surface/85 backdrop-blur-sm">
  <div className={`flex h-11 items-center gap-2 bg-transparent pr-3 ${windowBarLeftInsetClass}`}>
    {projectAndBranchControls}
    <div className="h-full min-w-0 flex-1" data-tauri-drag-region />
  </div>
  {/* rest of app header */}
</header>
```

Why `pl-[4.75rem]` on macOS:
- reserves room for traffic lights so custom controls do not overlap them.

## 6. Selector Styling (Zed-like)

Project/branch selectors were intentionally styled as text-like controls (not boxed pills):

```tsx
className="inline-flex h-7 items-center gap-1.5 rounded-sm px-1.5 text-text/90 transition-colors hover:bg-elevated/45 hover:text-text"
```

## 7. New Windows Must Match Main Window

When opening additional project windows, apply the same titlebar options:

File: `src/shared/openProjectInNewWindow.ts`

```ts
new WebviewWindow(label, {
  title: windowTitle,
  url: projectUrl,
  width: 1280,
  height: 820,
  resizable: true,
  decorations: true,
  titleBarStyle: "overlay",
  hiddenTitle: true,
  trafficLightPosition: new LogicalPosition(14, 18),
  focus: true,
});
```

## 8. Current UX Choices in This Repo

In the main content header, we removed:
- repository absolute path line
- app-name badge banner

So the top custom bar stays clean and minimal.

## 9. Troubleshooting

### Error: `window.start_dragging not allowed`
- Add `"core:window:allow-start-dragging"` in capability permissions.
- Fully restart `tauri dev`.

### Config changes not taking effect
- Stop and restart app (`yarn tauri dev`).
- `tauri.conf.json` changes do not hot-reload reliably.

### Yarn command fails with “no package.json”
- Run from repo root:

```bash
cd /Users/clawdia/Documents/Projects/easy_visualization
yarn tauri dev
```

## 10. Quick Checklist for Future Projects

1. Configure window with overlay title bar + hidden native title.
2. Add drag permission (`allow-start-dragging`).
3. Add top React strip with `data-tauri-drag-region`.
4. Reserve left inset for traffic lights on macOS.
5. Apply same window options to all newly opened windows.
6. Restart Tauri after config/capability changes.
