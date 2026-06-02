"use client";

import type { PublishLogEntry } from "@/lib/publish-flow-log";
import { cn } from "@/lib/utils";

const phaseLabel: Record<PublishLogEntry["phase"], string> = {
  seal: "Seal",
  walrus: "Walrus",
  sui: "Sui",
  wallet: "Wallet",
};

export function PublishFlowLogPanel({
  entries,
  className,
}: {
  entries: readonly PublishLogEntry[];
  className?: string;
}) {
  if (entries.length === 0) return null;

  return (
    <div
      className={cn(
        "max-h-48 overflow-y-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed",
        className,
      )}
      aria-live="polite"
    >
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={cn(
            "border-b border-border/50 py-1 last:border-0",
            entry.level === "error" && "text-destructive",
            entry.level === "success" && "text-emerald-700 dark:text-emerald-400",
          )}
        >
          <span className="text-muted-foreground">[{phaseLabel[entry.phase]}]</span> {entry.message}
          {entry.detail ? (
            <div className="mt-0.5 whitespace-pre-wrap break-all text-muted-foreground">{entry.detail}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
