export const AGENT_NODE_W = 176;
export const AGENT_NODE_H = 120;
export const SKILL_NODE_W = 200;
export const SKILL_NODE_H = 56;
export const SKILL_ORBIT_RADIUS = 190;
export const SKILL_ANGLE_STEP_DEG = 48;
export const SKILL_NODE_GAP = 20;

type Rect = { x: number; y: number; w: number; h: number };

function agentRect(agentX: number, agentY: number): Rect {
  return { x: agentX, y: agentY, w: AGENT_NODE_W, h: AGENT_NODE_H };
}

function skillRect(x: number, y: number): Rect {
  return { x, y, w: SKILL_NODE_W, h: SKILL_NODE_H };
}

function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return (
    a.x < b.x + b.w + gap &&
    a.x + a.w + gap > b.x &&
    a.y < b.y + b.h + gap &&
    a.y + a.h + gap > b.y
  );
}

export function defaultSkillPosition(
  agentX: number,
  agentY: number,
  index: number,
): { x: number; y: number } {
  const agentCx = agentX + AGENT_NODE_W / 2;
  const agentCy = agentY + AGENT_NODE_H / 2;

  // Fan out clockwise starting below the agent.
  const angleDeg = 90 + index * SKILL_ANGLE_STEP_DEG;
  const angle = (angleDeg * Math.PI) / 180;

  const skillCx = agentCx + Math.cos(angle) * SKILL_ORBIT_RADIUS;
  const skillCy = agentCy + Math.sin(angle) * SKILL_ORBIT_RADIUS;

  return {
    x: skillCx - SKILL_NODE_W / 2,
    y: skillCy - SKILL_NODE_H / 2,
  };
}

export function resolveSkillAttachPosition(
  agentX: number,
  agentY: number,
  existingSkills: readonly { x: number; y: number }[],
  preferred?: { x: number; y: number } | null,
): { x: number; y: number } {
  const agent = agentRect(agentX, agentY);
  const existingRects = existingSkills.map((s) => skillRect(s.x, s.y));

  const isClear = (x: number, y: number) => {
    const rect = skillRect(x, y);
    if (rectsOverlap(rect, agent, SKILL_NODE_GAP)) return false;
    return !existingRects.some((existing) => rectsOverlap(rect, existing, SKILL_NODE_GAP));
  };

  if (preferred && isClear(preferred.x, preferred.y)) {
    return preferred;
  }

  for (let i = 0; i < 24; i++) {
    const slot = defaultSkillPosition(agentX, agentY, i);
    if (isClear(slot.x, slot.y)) return slot;
  }

  const agentCx = agentX + AGENT_NODE_W / 2;
  const agentCy = agentY + AGENT_NODE_H / 2;
  for (let radius = SKILL_ORBIT_RADIUS; radius < SKILL_ORBIT_RADIUS + 400; radius += 40) {
    for (let angleDeg = 0; angleDeg < 360; angleDeg += 30) {
      const angle = (angleDeg * Math.PI) / 180;
      const x = agentCx + Math.cos(angle) * radius - SKILL_NODE_W / 2;
      const y = agentCy + Math.sin(angle) * radius - SKILL_NODE_H / 2;
      if (isClear(x, y)) return { x, y };
    }
  }

  return defaultSkillPosition(agentX, agentY, existingSkills.length);
}

export function defaultAgentCenter(viewportWidth: number, viewportHeight: number): {
  x: number;
  y: number;
} {
  return {
    x: Math.max(0, viewportWidth / 2 - AGENT_NODE_W / 2),
    y: Math.max(0, viewportHeight / 2 - AGENT_NODE_H / 2),
  };
}
