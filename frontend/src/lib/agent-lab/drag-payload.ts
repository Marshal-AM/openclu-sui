export const SKILL_DRAG_MIME = "application/x-openclu-skill";

export type SkillDragPayload = {
  purchaseObjectId: string;
  title: string;
  skillSlug: string;
};

export function encodeSkillDragPayload(payload: SkillDragPayload): string {
  return JSON.stringify(payload);
}

/** Set both custom MIME and text/plain — some browsers only expose text/plain on drop. */
export function setSkillDragData(dataTransfer: DataTransfer, payload: SkillDragPayload): void {
  const encoded = encodeSkillDragPayload(payload);
  dataTransfer.setData(SKILL_DRAG_MIME, encoded);
  dataTransfer.setData("text/plain", encoded);
  dataTransfer.effectAllowed = "copy";
}

export function decodeSkillDragPayload(raw: string): SkillDragPayload | null {
  try {
    const parsed = JSON.parse(raw) as SkillDragPayload;
    if (
      typeof parsed.purchaseObjectId === "string" &&
      typeof parsed.title === "string" &&
      typeof parsed.skillSlug === "string"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
