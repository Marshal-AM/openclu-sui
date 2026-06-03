"use client";

import type { AttachedCanvasSkill } from "@/lib/agent-lab/agent-lab-store";

const SKILL_NODE_W = 200;
const SKILL_NODE_H = 56;
const AGENT_NODE_W = 176;
const AGENT_NODE_H = 120;

type CanvasConnectionsProps = {
  agentX: number;
  agentY: number;
  skills: AttachedCanvasSkill[];
};

export function CanvasConnections({ agentX, agentY, skills }: CanvasConnectionsProps) {
  const agentCx = agentX + AGENT_NODE_W / 2;
  const agentCy = agentY + AGENT_NODE_H / 2;

  if (skills.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 h-[4000px] w-[4000px] overflow-visible"
      aria-hidden
    >
      {skills.map((skill) => {
        const skillCx = skill.x + SKILL_NODE_W / 2;
        const skillCy = skill.y + SKILL_NODE_H / 2;
        return (
          <line
            key={skill.purchaseObjectId}
            x1={agentCx}
            y1={agentCy}
            x2={skillCx}
            y2={skillCy}
            stroke="currentColor"
            strokeWidth={2}
            strokeOpacity={0.35}
            className="text-primary"
          />
        );
      })}
    </svg>
  );
}
