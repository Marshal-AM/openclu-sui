import { createReadStream } from "node:fs";
import Groq from "groq-sdk";
import { probeMediaStreams } from "@/lib/video-ffmpeg";
import { mergeSkillMd } from "@/lib/skill-md";
import sharp from "sharp";
import type { FrameAnnotation, Transcript } from "@/lib/skill-md";
import type { FrameManifestEntry } from "@/lib/video-ffmpeg";

const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const TEXT_MODEL = "llama-3.3-70b-versatile";
const FRAMES_PER_BATCH = 5;
const MAX_FRAME_KB = 3500;

const SKILL_EXTRACTION_PROMPT = `
You are an expert at extracting structured skill knowledge from recordings of human experts.

You will receive:
1. A full audio transcript (with timestamps) of someone demonstrating a skill
2. Screen frame annotations showing what was happening on screen at each moment

Your job is to extract a complete SKILL.md file for an AI agent to use.

The SKILL.md format is:
---
name: <kebab-case-name>
description: <one sentence: what this skill does and when to use it>
triggers:
  - "<natural language phrase that would invoke this skill>"
  - "<another trigger phrase>"
expertise_source: human_recording
recorded_at: <ISO date>
---

## Overview
<2-3 sentences about what this skill accomplishes>

## Prerequisites
<bulleted list of what must be true before starting>

## Steps
<numbered list of steps. For each step that involves a decision, add a nested list of branches>

## Decision branches
<key decision points and what to do in each case>

## Common mistakes
<what the expert avoided or corrected>

## Tools and context
<what applications, commands, APIs, or resources are used>

## Notes
<tacit knowledge, tips, timing cues, anything the expert said that reveals their reasoning>

---

Transcript:
{transcript}

Frame annotations:
{frame_annotations}

Respond ONLY with the complete SKILL.md content, starting with ---.
`;

function getClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set. Add it to frontend/.env.local");
  }
  return new Groq({ apiKey });
}

async function encodeFrameJpeg(path: string): Promise<string> {
  let pipeline = sharp(path);
  let quality = 80;

  for (let attempt = 0; attempt < 8; attempt++) {
    const buf = await pipeline.jpeg({ quality }).toBuffer();
    const sizeKb = buf.length / 1024;
    if (sizeKb <= MAX_FRAME_KB || quality < 30) {
      return buf.toString("base64");
    }
    const meta = await sharp(path).metadata();
    const w = meta.width ?? 1920;
    const h = meta.height ?? 1080;
    pipeline = sharp(path).resize(Math.round(w * 0.8), Math.round(h * 0.8));
    quality = Math.max(quality - 10, 30);
  }

  const buf = await sharp(path).jpeg({ quality: 30 }).toBuffer();
  return buf.toString("base64");
}

export async function transcribeAudio(audioPath: string): Promise<Transcript> {
  const client = getClient();

  const response = (await client.audio.transcriptions.create({
    file: createReadStream(audioPath),
    model: "whisper-large-v3",
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  })) as {
    text?: string;
    language?: string;
    segments?: Array<{ start?: number; end?: number; text?: string }>;
  };

  const segments = (response.segments ?? []).map((s) => ({
    t_start: Math.round((s.start ?? 0) * 100) / 100,
    t_end: Math.round((s.end ?? 0) * 100) / 100,
    text: (s.text ?? "").trim(),
  }));

  return {
    full_text: response.text ?? "",
    segments,
    language: response.language,
  };
}

export async function annotateFrames(
  manifest: FrameManifestEntry[],
  framePaths: string[],
): Promise<FrameAnnotation[]> {
  if (!manifest.length) return [];

  const client = getClient();
  const annotations: FrameAnnotation[] = [];

  for (let batchStart = 0; batchStart < framePaths.length; batchStart += FRAMES_PER_BATCH) {
    const batchPaths = framePaths.slice(batchStart, batchStart + FRAMES_PER_BATCH);
    const batchMeta = manifest.slice(batchStart, batchStart + FRAMES_PER_BATCH);

    const content: Array<Record<string, unknown>> = [
      {
        type: "text",
        text:
          "You are analyzing screen recording frames from an expert demonstrating a skill. " +
          "For EACH frame below, describe concisely: " +
          "(1) what application/tool is visible, " +
          "(2) what action appears to be happening, " +
          "(3) any key UI elements, text, or data visible. " +
          'Format your response as a JSON array with one object per frame: ' +
          '[{"frame": 0, "app": "...", "action": "...", "details": "..."}]. ' +
          "Return only the JSON array, no other text.",
      },
    ];

    for (let i = 0; i < batchMeta.length; i++) {
      const meta = batchMeta[i];
      const path = batchPaths[i];
      if (!path) continue;
      const b64 = await encodeFrameJpeg(path);
      content.push({
        type: "text",
        text: `Frame ${meta.index} (t=${meta.timestamp.toFixed(1)}s):`,
      });
      content.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${b64}` },
      });
    }

    try {
      const response = await client.chat.completions.create({
        model: VISION_MODEL,
        messages: [{ role: "user", content: content as never }],
        max_tokens: 1024,
        temperature: 0.1,
      });

      let raw = response.choices[0]?.message?.content?.trim() ?? "[]";
      if (raw.startsWith("```")) {
        raw = raw.split("```")[1] ?? raw;
        if (raw.startsWith("json")) raw = raw.slice(4);
      }

      const batchAnnotations = JSON.parse(raw) as FrameAnnotation[];
      for (const ann of batchAnnotations) {
        const frameIdx = ann.frame ?? 0;
        if (frameIdx < manifest.length) {
          ann.timestamp = manifest[frameIdx].timestamp;
        }
      }
      annotations.push(...batchAnnotations);
    } catch (err) {
      for (const meta of batchMeta) {
        annotations.push({
          frame: meta.index,
          timestamp: meta.timestamp,
          app: "unknown",
          action: "annotation failed",
          details: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return annotations;
}

export async function extractSkillMd(
  transcript: Transcript,
  frameAnnotations: FrameAnnotation[],
): Promise<string> {
  const client = getClient();

  const transcriptText =
    transcript.segments
      .map((s) => `[${s.t_start.toFixed(1)}s–${s.t_end.toFixed(1)}s] ${s.text}`)
      .join("\n") || "(no audio transcript available)";

  const framesText =
    frameAnnotations
      .map(
        (a) =>
          `[t=${(a.timestamp ?? 0).toFixed(1)}s] app=${a.app ?? "?"} | ` +
          `action=${a.action ?? "?"} | details=${a.details ?? "?"}`,
      )
      .join("\n") || "(no frame annotations available)";

  const prompt = SKILL_EXTRACTION_PROMPT.replace("{transcript}", transcriptText).replace(
    "{frame_annotations}",
    framesText,
  );

  const response = await client.chat.completions.create({
    model: TEXT_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You extract structured AI agent skills from human recordings. Output only valid SKILL.md content.",
      },
      { role: "user", content: prompt },
    ],
    max_tokens: 4096,
    temperature: 0.2,
  });

  return response.choices[0]?.message?.content?.trim() ?? "";
}

export type ProcessRecordingResult = {
  skillMd: string;
  transcript: Transcript;
  frameAnnotations: FrameAnnotation[];
  audioWarning: string | null;
  videoWarning: string | null;
};

function emptyTranscript(): Transcript {
  return { full_text: "", segments: [] };
}

async function transcribeFromVideo(videoPath: string): Promise<{
  transcript: Transcript;
  audioWarning: string | null;
}> {
  let hasAudio = false;
  try {
    hasAudio = (await probeMediaStreams(videoPath)).hasAudio;
  } catch {
    return {
      transcript: emptyTranscript(),
      audioWarning:
        "Recording file could not be read for audio (it may still have worked in the browser). " +
        "Skill was built from screen frames and your brief.",
    };
  }

  if (!hasAudio) {
    return {
      transcript: emptyTranscript(),
      audioWarning:
        "No audio track detected. Enable “Also share system audio” when sharing your screen, " +
        "or allow microphone access. Skill was built from screen frames and your brief.",
    };
  }

  try {
    return { transcript: await transcribeAudio(videoPath), audioWarning: null };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      transcript: emptyTranscript(),
      audioWarning: `Audio transcription skipped (${detail}). Skill was built from screen frames and your brief.`,
    };
  }
}

export async function processRecordingForSkill(
  videoPath: string,
  _workDir: string,
  draftSkillMd: string,
  clientFrames: { manifest: FrameManifestEntry[]; framePaths: string[] },
): Promise<ProcessRecordingResult> {
  let videoWarning: string | null = null;
  if (clientFrames.framePaths.length === 0) {
    videoWarning =
      "No screen frames were captured in the browser. SKILL.md used your title, description, and any audio only.";
  }

  const { transcript, audioWarning } = await transcribeFromVideo(videoPath);

  const frameAnnotations =
    clientFrames.manifest.length > 0
      ? await annotateFrames(clientFrames.manifest, clientFrames.framePaths)
      : [];

  const generatedMd = await extractSkillMd(transcript, frameAnnotations);
  const skillMd = mergeSkillMd(draftSkillMd, generatedMd);

  return { skillMd, transcript, frameAnnotations, audioWarning, videoWarning };
}

/** @deprecated Use processRecordingForSkill */
export const processRecordingFromMp4 = processRecordingForSkill;
