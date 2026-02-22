import React from "react";
import ReactDOM from "react-dom/client";
import "react-loading-skeleton/dist/skeleton.css";

import { initializeTheme } from "./design-system/theme/index.ts";
import "./design-system/tokens/theme.css";
import "./styles/global.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element for React mount.");
}

const ensuredRootElement: HTMLElement = rootElement;

let root: ReactDOM.Root | null = null;

function getRoot(): ReactDOM.Root {
  if (!root) {
    root = ReactDOM.createRoot(ensuredRootElement);
  }

  return root;
}

function formatErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return "Unknown error";
  }
}

function renderStartupError(title: string, error: unknown): void {
  const details = formatErrorDetails(error);

  getRoot().render(
    <div className="min-h-screen bg-canvas p-4 text-text">
      <div className="mx-auto max-w-3xl rounded-lg border border-danger/40 bg-surface shadow-soft">
        <div className="border-b border-danger/30 bg-danger/10 px-4 py-3">
          <h1 className="font-display text-base font-semibold text-danger">{title}</h1>
        </div>
        <div className="space-y-2 px-4 py-3">
          <p className="text-sm text-muted">
            The desktop app failed during startup. The error details below will identify the failing module.
          </p>
          <pre className="max-h-[45vh] overflow-auto rounded-md border border-border bg-canvas p-3 font-mono text-xs text-text">
            {details}
          </pre>
        </div>
      </div>
    </div>,
  );
}

window.addEventListener("error", (event) => {
  renderStartupError("Runtime Error", event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  renderStartupError("Unhandled Promise Rejection", event.reason);
});

async function bootstrap(): Promise<void> {
  try {
    initializeTheme();
    const { App } = await import("./app/App.tsx");

    getRoot().render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  } catch (error) {
    renderStartupError("Application Bootstrap Failed", error);
  }
}

void bootstrap();
