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

export function mergeSkillMd(draftMd: string, generatedMd: string): string {
  const existingFm = draftMd.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  if (!existingFm) return generatedMd;

  const genBodyMatch = generatedMd.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)/);
  const genBody = genBodyMatch?.[1]?.trim() ?? generatedMd;
  return `---\n${existingFm}\n---\n\n${genBody}\n`;
}
