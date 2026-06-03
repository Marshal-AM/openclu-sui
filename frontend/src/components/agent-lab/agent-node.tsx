"use client";

import { BotIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type AgentNodeProps = {
  isDropTarget: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
};

export function AgentNode({ isDropTarget, onDragOver, onDragLeave, onDrop }: AgentNodeProps) {
  return (
    <div
      data-canvas-node
      className={cn(
        "agent-lab-canvas-node z-10 flex w-44 flex-col items-center gap-2 rounded-xl border-2 bg-card px-4 py-5 shadow-md transition-colors",
        isDropTarget ? "border-primary ring-4 ring-primary/20" : "border-border",
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
        <BotIcon className="size-6" />
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold">Agent</p>
        <p className="text-xs text-muted-foreground">Drop skills here</p>
      </div>
    </div>
  );
}
