import { useEffect, useState } from "react";

import type { CodePreview, FlowCodeReference } from "../types";

interface UseCodePreviewResult {
  codePreview: CodePreview | null;
  isLoading: boolean;
  errorMessage: string | null;
}

interface SourcePreviewResponse {
  path: string;
  line: number;
  startLine: number;
  endLine: number;
  snippet: string;
}

interface SourcePreviewErrorResponse {
  error?: string;
}

const DEFAULT_CONTEXT_LINES = 8;

function isSourcePreviewResponse(value: unknown): value is SourcePreviewResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<SourcePreviewResponse>;
  return (
    typeof candidate.path === "string" &&
    typeof candidate.line === "number" &&
    typeof candidate.startLine === "number" &&
    typeof candidate.endLine === "number" &&
    typeof candidate.snippet === "string"
  );
}

export function useCodePreview(
  codeRef: FlowCodeReference | null,
  repoRoot: string | null,
): UseCodePreviewResult {
  const [codePreview, setCodePreview] = useState<CodePreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (codeRef === null) {
      setCodePreview(null);
      setIsLoading(false);
      setErrorMessage(null);
      return;
    }

    const abortController = new AbortController();
    const searchParams = new URLSearchParams({
      path: codeRef.path,
      line: String(codeRef.line),
      context: String(DEFAULT_CONTEXT_LINES),
    });
    if (repoRoot !== null && repoRoot.trim().length > 0) {
      searchParams.set("repoRoot", repoRoot.trim());
    }

    setIsLoading(true);
    setErrorMessage(null);
    setCodePreview(null);

    fetch(`/api/source?${searchParams.toString()}`, { signal: abortController.signal })
      .then(async (response) => {
        const body = (await response.json()) as unknown;

        if (!response.ok) {
          const typedBody = body as SourcePreviewErrorResponse;
          const message =
            typeof typedBody.error === "string" ? typedBody.error : "Unable to load code preview.";
          throw new Error(message);
        }

        if (!isSourcePreviewResponse(body)) {
          throw new Error("Code preview response format is invalid.");
        }

        const preview: CodePreview = {
          path: body.path,
          line: body.line,
          startLine: body.startLine,
          endLine: body.endLine,
          snippet: body.snippet,
        };

        setCodePreview(preview);
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) {
          return;
        }

        const message = error instanceof Error ? error.message : "Unable to load code preview.";
        setErrorMessage(message);
      })
      .finally(() => {
        if (abortController.signal.aborted) {
          return;
        }

        setIsLoading(false);
      });

    return () => {
      abortController.abort();
    };
  }, [codeRef?.line, codeRef?.path, repoRoot]);

  return {
    codePreview,
    isLoading,
    errorMessage,
  };
}
