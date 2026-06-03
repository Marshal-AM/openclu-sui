import { createReadStream } from "node:fs";
import { join } from "node:path";
import Groq from "groq-sdk";
import {
  extractAudioForTranscription,
  probeAudioByExtraction,
  probeMediaStreams,
  readJpegAsBase64,
} from "@/lib/video-ffmpeg";
import { mergeSkillMd, type SkillBriefInput } from "@/lib/skill-md";
import type { FrameAnnotation, Transcript } from "@/lib/skill-md";
import type { FrameManifestEntry } from "@/lib/video-ffmpeg";

const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const TEXT_MODEL = "llama-3.3-70b-versatile";
const FRAMES_PER_BATCH = 4;
const MAX_FRAME_KB = 3500;

const SKILL_EXTRACTION_PROMPT = `
You extract SKILL.md for an AI agent from a screen recording where a human expert demonstrates concrete practices (often code review comments, fixes, or walkthroughs).

Recording intent (from the contributor — use as context only; do NOT copy verbatim if the demo shows more specific detail):
Title: {brief_title}
Contributor description: {brief_description}

CRITICAL RULES:
- The skill must capture SPECIFIC practices, rules, and examples shown or spoken in the recording — not a generic tutorial.
- If the expert left PR/code review comments, lists each one with file/line when visible, the issue, and the recommended fix.
- If the transcript or frames mention HTML, CSS, accessibility, tables, semantic elements, etc., those MUST appear as explicit rules in the skill body.
- Do NOT invent generic "navigate to GitHub" steps unless the demo literally focused on navigation with no technical substance.
- Prefer quoting or closely paraphrasing the expert's comments from the transcript and on-screen text.

Required SKILL.md structure (after YAML frontmatter):
---
name: <kebab-case>
description: <one sentence summarizing the SPECIFIC practices taught, not the recording process>
triggers: ...
expertise_source: human_recording
recorded_at: <ISO date>
---

## Overview
2-3 sentences on the specific expertise being transferred.

## Rules and standards (from demonstration)
Bulleted list of every concrete rule/practice demonstrated. Each bullet: **Rule** — why it matters. Include file:line or code examples when available.

## Demonstrated examples
For each review comment or fix shown: location (file:line), what was wrong, what to do instead (use the expert's wording when possible).

## Prerequisites
Only what is actually needed for this skill.

## Steps
Numbered steps an agent should follow to APPLY these rules (not vague "review the PR" only).

## Decision branches
Real decision points from the demo.

## Common mistakes
Mistakes the expert called out or corrected.

## Tools and context
Apps/sites actually visible (e.g. GitHub PR, VS Code).

## Notes
Tacit knowledge from audio or screen text not covered above.

---

Full audio transcript (may be empty if no mic/system audio):
{transcript}

Screen capture analysis (includes visible on-screen text when captured):
{frame_annotations}

Respond ONLY with complete SKILL.md starting with ---.
`;

function getClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set. Add it to frontend/.env.local");
  }
  return new Groq({ apiKey });
}

async function encodeFrameJpeg(path: string): Promise<string> {
  return readJpegAsBase64(path, MAX_FRAME_KB);
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
          "You analyze screen-recording frames of an expert demonstrating a skill (often a PR/code review). " +
          "For EACH frame, extract:\n" +
          "- app: application/site (e.g. GitHub, VS Code)\n" +
          "- action: what the user is doing\n" +
          "- details: summary of the screen\n" +
          "- visible_text: ALL readable text verbatim or near-verbatim (PR review comments, code, labels). Use empty string if none.\n" +
          "- file_references: file paths and line numbers visible (e.g. index.html:23-52). Use empty string if none.\n\n" +
          'Return ONLY a JSON array: [{"frame":0,"app":"...","action":"...","details":"...","visible_text":"...","file_references":"..."}]',
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
        max_tokens: 2048,
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
          visible_text: "",
          file_references: "",
        });
      }
    }
  }

  return annotations;
}

function formatFrameAnnotationsForPrompt(annotations: FrameAnnotation[]): string {
  if (!annotations.length) return "(no frame annotations available)";
  return annotations
    .map((a) => {
      const parts = [
        `[t=${(a.timestamp ?? 0).toFixed(1)}s]`,
        `app=${a.app ?? "?"}`,
        `action=${a.action ?? "?"}`,
        `details=${a.details ?? "?"}`,
      ];
      if (a.visible_text?.trim()) parts.push(`visible_text=${a.visible_text.trim()}`);
      if (a.file_references?.trim()) parts.push(`file_references=${a.file_references.trim()}`);
      return parts.join(" | ");
    })
    .join("\n");
}

function formatTranscriptForPrompt(transcript: Transcript): string {
  if (transcript.full_text?.trim()) {
    const lines = transcript.segments
      .map((s) => `[${s.t_start.toFixed(1)}s–${s.t_end.toFixed(1)}s] ${s.text}`)
      .join("\n");
    return `FULL TEXT:\n${transcript.full_text.trim()}\n\nSEGMENTS:\n${lines || "(no segments)"}`;
  }
  return transcript.segments.length
    ? transcript.segments
        .map((s) => `[${s.t_start.toFixed(1)}s–${s.t_end.toFixed(1)}s] ${s.text}`)
        .join("\n")
    : "(no audio transcript — rely on screen visible_text from frames)";
}

export async function extractSkillMd(
  transcript: Transcript,
  frameAnnotations: FrameAnnotation[],
  brief: SkillBriefInput,
): Promise<string> {
  const client = getClient();

  const prompt = SKILL_EXTRACTION_PROMPT.replace("{brief_title}", brief.title.trim())
    .replace("{brief_description}", brief.description.trim())
    .replace("{transcript}", formatTranscriptForPrompt(transcript))
    .replace("{frame_annotations}", formatFrameAnnotationsForPrompt(frameAnnotations));

  const response = await client.chat.completions.create({
    model: TEXT_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You extract concrete, actionable agent skills from recordings. Never output generic filler. " +
          "Always include specific rules and examples from the transcript and on-screen text.",
      },
      { role: "user", content: prompt },
    ],
    max_tokens: 4096,
    temperature: 0.15,
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

function shortTranscriptionError(message: string): string {
  const line =
    message
      .split("\n")
      .map((s) => s.trim())
      .find((s) => s.length > 0) ?? message;
  return line.length > 220 ? `${line.slice(0, 217)}…` : line;
}

async function transcribeFromVideo(
  videoPath: string,
  workDir: string,
  clientHadAudioTracks: boolean,
  narrationAudioPath?: string,
): Promise<{
  transcript: Transcript;
  audioWarning: string | null;
}> {
  const attempts: Array<{ label: string; run: () => Promise<Transcript> }> = [];

  if (narrationAudioPath) {
    attempts.push({
      label: "narration-wav",
      run: async () => {
        const wavPath = join(workDir, "narration-for-whisper.wav");
        await extractAudioForTranscription(narrationAudioPath, wavPath);
        return transcribeAudio(wavPath);
      },
    });
    attempts.push({
      label: "narration-mp3",
      run: async () => {
        const mp3Path = join(workDir, "narration-for-whisper.mp3");
        await extractAudioForTranscription(narrationAudioPath, mp3Path);
        return transcribeAudio(mp3Path);
      },
    });
    attempts.push({
      label: "narration-direct",
      run: async () => transcribeAudio(narrationAudioPath),
    });
  }

  attempts.push(
    {
      label: "video-direct",
      run: async () => transcribeAudio(videoPath),
    },
    {
      label: "video-mp3",
      run: async () => {
        const mp3Path = join(workDir, "audio-for-whisper.mp3");
        await extractAudioForTranscription(videoPath, mp3Path);
        return transcribeAudio(mp3Path);
      },
    },
  );

  let lastError = "";
  for (const { label, run } of attempts) {
    try {
      const transcript = await run();
      if (transcript.full_text.trim() || transcript.segments.length > 0) {
        return { transcript, audioWarning: null };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;
      console.warn(`[process-recording] transcription ${label} failed:`, shortTranscriptionError(msg));
    }
  }

  let probeSaysAudio = false;
  try {
    const probe = await probeMediaStreams(videoPath);
    probeSaysAudio = probe.hasAudio;
    if (!probeSaysAudio && (clientHadAudioTracks || probe.hasVideo)) {
      probeSaysAudio = await probeAudioByExtraction(videoPath, workDir);
    }
  } catch {
    /* ignore */
  }

  if (clientHadAudioTracks || probeSaysAudio) {
    return {
      transcript: emptyTranscript(),
      audioWarning:
        `Voice was captured but transcription failed (${shortTranscriptionError(lastError || "empty result")}). ` +
        "Skill was built from screen frames. Record at least 15 seconds with narration on http://localhost:3000/record in Edge.",
    };
  }

  return {
    transcript: emptyTranscript(),
    audioWarning:
      "No usable audio in the upload. Allow microphone access when prompted (required for narration). " +
      "Skill was built from screen frames — speak your comments aloud for richer skills.",
  };
}

export async function processRecordingForSkill(
  videoPath: string,
  workDir: string,
  draftSkillMd: string,
  clientFrames: { manifest: FrameManifestEntry[]; framePaths: string[] },
  brief: SkillBriefInput,
  options?: { clientHadAudioTracks?: boolean; narrationAudioPath?: string },
): Promise<ProcessRecordingResult> {
  let videoWarning: string | null = null;
  if (clientFrames.framePaths.length === 0) {
    videoWarning =
      "No screen frames were captured in the browser. SKILL.md used your title, description, and any audio only.";
  }

  const { transcript, audioWarning } = await transcribeFromVideo(
    videoPath,
    workDir,
    options?.clientHadAudioTracks ?? false,
    options?.narrationAudioPath,
  );

  const frameAnnotations =
    clientFrames.manifest.length > 0
      ? await annotateFrames(clientFrames.manifest, clientFrames.framePaths)
      : [];

  const generatedMd = await extractSkillMd(transcript, frameAnnotations, brief);
  const skillMd = mergeSkillMd(draftSkillMd, generatedMd);

  return { skillMd, transcript, frameAnnotations, audioWarning, videoWarning };
}

/** @deprecated Use processRecordingForSkill */
export const processRecordingFromMp4 = processRecordingForSkill;
