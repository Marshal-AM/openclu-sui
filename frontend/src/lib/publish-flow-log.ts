export type PublishFlowPhase = "seal" | "walrus" | "sui" | "wallet";

export type PublishLogLevel = "info" | "success" | "error" | "detail";

export interface PublishLogEntry {
  id: string;
  at: number;
  phase: PublishFlowPhase;
  level: PublishLogLevel;
  message: string;
  detail?: string;
}

export type PublishFlowLogger = {
  log: (
    phase: PublishFlowPhase,
    message: string,
    options?: { level?: PublishLogLevel; detail?: string },
  ) => void;
  entries: () => readonly PublishLogEntry[];
  subscribe: (listener: () => void) => () => void;
};

let nextId = 0;

export function createPublishFlowLogger(): PublishFlowLogger {
  const entries: PublishLogEntry[] = [];
  const listeners = new Set<() => void>();

  const log: PublishFlowLogger["log"] = (phase, message, options) => {
    const level = options?.level ?? "info";
    const entry: PublishLogEntry = {
      id: String(++nextId),
      at: Date.now(),
      phase,
      level,
      message,
      detail: options?.detail,
    };
    entries.push(entry);
    const prefix = `[OpenClu/${phase}]`;
    if (level === "error") {
      console.error(prefix, message, options?.detail ?? "");
    } else {
      console.log(prefix, message, options?.detail ?? "");
    }
    listeners.forEach((l) => l());
  };

  return {
    log,
    entries: () => entries,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
