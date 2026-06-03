export type SkillBriefInput = {
  skillSlug: string;
  title: string;
  description: string;
  triggers: string;
  extraTags: string;
  expertiseSource: string;
  recordedAt?: string;
};

export type TranscriptSegment = {
  t_start: number;
  t_end: number;
  text: string;
};

export type Transcript = {
  full_text: string;
  segments: TranscriptSegment[];
  language?: string;
};

export type FrameAnnotation = {
  frame: number;
  timestamp?: number;
  app: string;
  action: string;
  details: string;
  /** Verbatim or near-verbatim on-screen text (PR comments, code, UI labels). */
  visible_text?: string;
  /** File paths, line numbers, or code snippets visible on screen. */
  file_references?: string;
};

export function parseTriggers(text: string): string[] {
  const lines = text
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean);
  return lines.length ? lines : ["general"];
}

export function parseExtraTags(text: string): string[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Form title/description/triggers are often placeholders during demo recordings. */
export function briefLooksLikePlaceholder(brief: SkillBriefInput): boolean {
  const title = brief.title.trim().toLowerCase();
  const description = brief.description.trim().toLowerCase();
  const triggers = brief.triggers.trim().toLowerCase();
  if (!title || !description) return false;
  if (title === description) return true;
  if (triggers && (triggers === title || triggers === description)) return true;
  if (description.length < 48 && title === description) return true;
  return false;
}

export function buildDraftSkillMd(brief: SkillBriefInput): string {
  const triggers = parseTriggers(brief.triggers);
  const extraTags = parseExtraTags(brief.extraTags);
  const recordedAt = brief.recordedAt ?? new Date().toISOString();
  const expertise = brief.expertiseSource.trim() || "human_recording";

  const triggerYaml = triggers.map((t) => `  - "${t.replace(/"/g, '\\"')}"`).join("\n");
  const extraTagsYaml = extraTags.length
    ? `extra_tags:\n${extraTags.map((t) => `  - "${t.replace(/"/g, '\\"')}"`).join("\n")}\n`
    : "";

  return `---
name: ${brief.skillSlug}
description: ${brief.description.trim()}
triggers:
${triggerYaml}
expertise_source: ${expertise}
recorded_at: ${recordedAt}
${extraTagsYaml}---

## Overview

${brief.description.trim()}
`;
}

function parseFrontmatterBlock(md: string): { fm: string; body: string } | null {
  const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;
  return { fm: match[1]!, body: match[2]!.trim() };
}

function pickDescription(
  draftFm: string,
  generatedFm: string,
  brief: SkillBriefInput,
): string {
  const fromGen = generatedFm.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const fromDraft = draftFm.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const placeholder = briefLooksLikePlaceholder(brief);

  if (fromGen && fromGen.length > 24 && !/involves the comments from a pr/i.test(fromGen)) {
    if (placeholder || fromGen.toLowerCase() !== fromDraft.toLowerCase()) {
      return fromGen;
    }
  }
  if (!placeholder && fromDraft) return fromDraft;
  return fromGen || fromDraft;
}

/** Generated SKILL.md echoed the form draft instead of the recording. */
export function skillBodyLooksLikePlaceholderEcho(
  body: string,
  brief: SkillBriefInput,
  transcript: Transcript,
): boolean {
  const spoken = transcript.full_text.trim();
  if (spoken.length < 60) return false;

  const title = brief.title.trim().toLowerCase();
  const description = brief.description.trim().toLowerCase();
  const overview =
    body.match(/##\s*Overview\s*\n+([\s\S]*?)(?=\n##\s|\n---|\z)/i)?.[1]?.trim().toLowerCase() ?? "";

  if (briefLooksLikePlaceholder(brief)) {
    if (overview === description || overview === title) return true;
    if (body.trim().toLowerCase() === description) return true;
  }

  const bodyLower = body.toLowerCase();
  const spokenHints = ["publish", "trigger", "description", "expertise", "record a skill", "opencube", "openclu"];
  const spokenHasHints = spokenHints.some((h) => spoken.toLowerCase().includes(h));
  const bodyHasHints = spokenHints.some((h) => bodyLower.includes(h));
  if (spokenHasHints && !bodyHasHints && body.length < 900) return true;

  return false;
}

export function mergeSkillMd(
  draftMd: string,
  generatedMd: string,
  brief?: SkillBriefInput,
): string {
  const draft = parseFrontmatterBlock(draftMd);
  const generated = parseFrontmatterBlock(generatedMd);
  if (!draft) return generatedMd;
  if (!generated) return draftMd;

  const description = pickDescription(
    draft.fm,
    generated.fm,
    brief ?? {
      skillSlug: "",
      title: "",
      description: draft.fm.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "",
      triggers: "",
      extraTags: "",
      expertiseSource: "",
    },
  );
  const descYaml = description.includes(":") || description.includes('"')
    ? `"${description.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
    : description;
  const mergedFm = draft.fm.replace(/^description:\s*.+$/m, `description: ${descYaml}`);

  return `---\n${mergedFm}\n---\n\n${generated.body}\n`;
}
