"use client";

import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AttachedCanvasSkill } from "@/lib/agent-lab/agent-lab-store";

type SkillNodeProps = {
  skill: AttachedCanvasSkill;
  style: React.CSSProperties;
  onRemove: () => void;
};

export function SkillNode({ skill, style, onRemove }: SkillNodeProps) {
  return (
    <div
      data-canvas-node
      className="agent-lab-canvas-node absolute z-10 flex w-[200px] items-start gap-2 rounded-lg border-2 border-primary/30 bg-card px-3 py-2 shadow-md"
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{skill.title}</p>
        <p className="truncate text-xs text-muted-foreground">{skill.skillSlug}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={`Remove ${skill.title}`}
      >
        <XIcon />
      </Button>
    </div>
  );
}
