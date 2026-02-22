import { Component, type ErrorInfo, type ReactNode } from "react";
import { Provider } from "react-redux";

import { ThemeProvider } from "../design-system/theme/index.ts";
import { createReviewStore } from "./store/review/index.ts";
import { ReviewWorkspaceContainer } from "../interface/review/index.ts";

let cachedStore: ReturnType<typeof createReviewStore> | null = null;
let cachedStoreError: Error | null = null;

function getReviewStore():
  | { readonly store: ReturnType<typeof createReviewStore>; readonly error: null }
  | { readonly store: null; readonly error: Error } {
  if (cachedStore) {
    return { store: cachedStore, error: null };
  }

  if (cachedStoreError) {
    return { store: null, error: cachedStoreError };
  }

  try {
    cachedStore = createReviewStore();
    return { store: cachedStore, error: null };
  } catch (error) {
    cachedStoreError = error instanceof Error ? error : new Error("Failed to create review store.");
    return { store: null, error: cachedStoreError };
  }
}

function StartupErrorPanel({ title, details }: { readonly title: string; readonly details: string }) {
  return (
    <div className="min-h-screen bg-canvas p-4 text-text">
      <div className="mx-auto max-w-3xl rounded-lg border border-danger/40 bg-surface shadow-soft">
        <div className="border-b border-danger/30 bg-danger/10 px-4 py-3">
          <h1 className="font-display text-base font-semibold text-danger">{title}</h1>
        </div>
        <div className="space-y-2 px-4 py-3">
          <p className="text-sm text-muted">
            The workspace failed to render. Restarting the app after this fix usually clears transient issues.
          </p>
          <pre className="max-h-[40vh] overflow-auto rounded-md border border-border bg-canvas p-3 font-mono text-xs text-text">
            {details}
          </pre>
        </div>
      </div>
    </div>
  );
}

interface AppErrorBoundaryState {
  readonly error: Error | null;
}

class AppErrorBoundary extends Component<{ readonly children: ReactNode }, AppErrorBoundaryState> {
  constructor(props: { readonly children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Keep runtime diagnostics available in devtools/console for root-cause tracing.
    console.error("Review workspace render error:", error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <StartupErrorPanel
          title="Review Workspace Crashed"
          details={`${this.state.error.name}: ${this.state.error.message}`}
        />
      );
    }

    return this.props.children;
  }
}

export function App() {
  const storeResult = getReviewStore();

  if (storeResult.error || !storeResult.store) {
    return (
      <ThemeProvider>
        <StartupErrorPanel
          title="Review Store Initialization Failed"
          details={storeResult.error?.stack ?? storeResult.error?.message ?? "Unknown startup error."}
        />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <AppErrorBoundary>
        <Provider store={storeResult.store}>
          <ReviewWorkspaceContainer />
        </Provider>
      </AppErrorBoundary>
    </ThemeProvider>
  );
}
