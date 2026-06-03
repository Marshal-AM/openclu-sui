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

function pickDescription(draftFm: string, generatedFm: string): string {
  const fromGen = generatedFm.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (fromGen && fromGen.length > 40 && !/involves the comments from a pr/i.test(fromGen)) {
    return fromGen;
  }
  return draftFm.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? fromGen ?? "";
}

export function mergeSkillMd(draftMd: string, generatedMd: string): string {
  const draft = parseFrontmatterBlock(draftMd);
  const generated = parseFrontmatterBlock(generatedMd);
  if (!draft) return generatedMd;
  if (!generated) return draftMd;

  const description = pickDescription(draft.fm, generated.fm);
  const descYaml = description.includes(":") || description.includes('"')
    ? `"${description.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
    : description;
  const mergedFm = draft.fm.replace(/^description:\s*.+$/m, `description: ${descYaml}`);

  return `---\n${mergedFm}\n---\n\n${generated.body}\n`;
}
