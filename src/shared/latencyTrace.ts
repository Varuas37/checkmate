type TraceFields = Readonly<Record<string, unknown>>;

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }

  return Date.now();
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function randomSuffix(length = 6): string {
  const source = "abcdefghijklmnopqrstuvwxyz0123456789";
  let output = "";
  for (let index = 0; index < length; index += 1) {
    output += source[Math.floor(Math.random() * source.length)] ?? "x";
  }
  return output;
}

export interface LatencyTrace {
  readonly traceId: string;
  readonly scope: string;
  mark(event: string, fields?: TraceFields): void;
  fail(error: unknown, fields?: TraceFields): void;
  end(fields?: TraceFields): void;
}

export interface StartLatencyTraceOptions {
  readonly traceId?: string;
  readonly scope: string;
  readonly fields?: TraceFields;
}

export function startLatencyTrace(options: StartLatencyTraceOptions): LatencyTrace {
  const traceId = options.traceId?.trim().length
    ? options.traceId
    : `${options.scope}-${Date.now()}-${randomSuffix()}`;
  const startedAt = nowMs();
  const basePayload = {
    traceId,
    scope: options.scope,
  };

  const log = (event: string, fields?: TraceFields) => {
    const elapsedMs = roundMs(nowMs() - startedAt);
    if (fields) {
      console.info("[ai-trace]", {
        ...basePayload,
        event,
        elapsedMs,
        ...fields,
      });
      return;
    }

    console.info("[ai-trace]", {
      ...basePayload,
      event,
      elapsedMs,
    });
  };

  log("start", options.fields);

  return {
    traceId,
    scope: options.scope,
    mark(event, fields) {
      log(event, fields);
    },
    fail(error, fields) {
      log("error", {
        error: normalizeError(error),
        ...fields,
      });
    },
    end(fields) {
      log("end", fields);
    },
  };
}

