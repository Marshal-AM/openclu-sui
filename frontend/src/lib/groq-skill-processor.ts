import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Groq from "groq-sdk";
import {
  extractAudioForTranscription,
  measureAudioLoudness,
  probeAudioByExtraction,
  probeMediaStreams,
  readJpegAsBase64,
  sniffVideoContainer,
  type AudioLoudnessStats,
  type VideoContainer,
} from "@/lib/video-ffmpeg";
import {
  briefLooksLikePlaceholder,
  mergeSkillMd,
  skillBodyLooksLikePlaceholderEcho,
  type SkillBriefInput,
} from "@/lib/skill-md";
import type { FrameAnnotation, Transcript } from "@/lib/skill-md";
import type { FrameManifestEntry } from "@/lib/video-ffmpeg";

const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const TEXT_MODEL = "llama-3.3-70b-versatile";
const FRAMES_PER_BATCH = 4;
const MAX_FRAME_KB = 3500;

const SKILL_EXTRACTION_PROMPT = `
You extract SKILL.md for an AI agent from a screen recording (code review, product walkthrough, or workflow demo).

{brief_context}

SOURCE PRIORITY (strict):
1. **Audio transcript** — primary. Every step, rule, and recommendation the expert SPOKE must appear in the skill.
2. **Screen frames** — UI labels, buttons, page names, field names, and on-screen instructions only.
3. **Form metadata** — NEVER copy title/description/triggers from the brief if they are placeholder text repeated on screen. Those are draft form values, not the skill.

CRITICAL RULES:
- Write the skill from what was **demonstrated and narrated**, not from repeated form filler visible in frames.
- For walkthroughs: capture the **procedure** (what to fill in, in what order, what "good" looks like) from the transcript.
- For PR/code review: list each comment with file:line, issue, and fix.
- YAML \`description:\` must summarize the **taught capability** (e.g. "How to record and publish an OpenClu skill from the Contribute Data page"), never repeat the draft title alone.
- \`## Overview\` must be 2–4 sentences derived from the transcript, not a copy of the form title/description.
- Include a \`## Steps\` section with numbered steps from the narration.
- Omit empty sections (e.g. skip "Demonstrated examples" if there was no code review).

Required SKILL.md structure (after YAML frontmatter):
---
name: {skill_slug}
description: <one sentence — what the agent learns to do, from the demo>
triggers: <infer 3–6 sensible triggers from the demo, or keep brief triggers if substantive>
expertise_source: human_recording
recorded_at: {recorded_at}
---

## Overview
## Steps
## Rules and standards (from demonstration)  (if applicable)
## Demonstrated examples  (if code/PR comments shown)
## Prerequisites
## Decision branches
## Common mistakes
## Tools and context
## Notes

---

AUDIO TRANSCRIPT (PRIMARY — use this):
{transcript}

SCREEN FRAMES (secondary — UI context; ignore repeated draft form values):
{frame_annotations}

Respond ONLY with complete SKILL.md starting with ---.
`;

const SKILL_EXTRACTION_STRICT_RETRY = `
Your previous SKILL.md only repeated the contributor's draft form text instead of the recording.

Rewrite the skill using ONLY the audio transcript and UI context below.
- Do NOT use these as skill content: title "{brief_title}", description "{brief_description}".
- The expert said: use the transcript below for all steps and overview content.
- Minimum: Overview (2+ sentences from speech) + Steps (numbered, from speech) + Tools and context.

AUDIO TRANSCRIPT:
{transcript}

SCREEN FRAMES:
{frame_annotations}

YAML name must be: {skill_slug}
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

export type TranscribeAttemptLog = {
  label: string;
  ok: boolean;
  error?: string;
  transcriptPreview?: string;
};

export type TranscribeNarrationDebugResult = {
  transcript: Transcript;
  attempts: TranscribeAttemptLog[];
  sniff: VideoContainer;
  magicHex: string;
  byteSize: number;
  loudness: AudioLoudnessStats;
};

/** Audio-only test / debug (same pipeline as skill narration sidecar). */
export async function transcribeNarrationFile(
  audioPath: string,
  workDir: string,
): Promise<TranscribeNarrationDebugResult> {
  const buf = await readFile(audioPath);
  const sniff = sniffVideoContainer(buf);
  const magicHex = buf.subarray(0, Math.min(8, buf.length)).toString("hex");

  const loudness = await measureAudioLoudness(audioPath);
  console.log("[test-audio] loudness", loudness);

  if (loudness.likelySilent) {
    console.warn(
      "[test-audio] File is very quiet (mean/max dB low) — Whisper may hallucinate on noise. " +
        `mean=${loudness.meanVolumeDb} max=${loudness.maxVolumeDb}`,
    );
  }

  const attempts: TranscribeAttemptLog[] = [];
  const tries: Array<{ label: string; run: () => Promise<Transcript> }> = [
    {
      label: "narration-wav",
      run: async () => {
        const wavPath = join(workDir, "test-narration.wav");
        await extractAudioForTranscription(audioPath, wavPath);
        return transcribeAudio(wavPath);
      },
    },
    {
      label: "narration-mp3",
      run: async () => {
        const mp3Path = join(workDir, "test-narration.mp3");
        await extractAudioForTranscription(audioPath, mp3Path);
        return transcribeAudio(mp3Path);
      },
    },
    { label: "narration-direct", run: async () => transcribeAudio(audioPath) },
  ];

  for (const { label, run } of tries) {
    try {
      const transcript = await run();
      const text = transcript.full_text.trim();
      attempts.push({
        label,
        ok: true,
        transcriptPreview: text.slice(0, 160) || "(empty text)",
      });
      if (text || transcript.segments.length > 0) {
        console.log(`[test-audio] ${label} ok chars=${text.length}`);
        return {
          transcript,
          attempts,
          sniff,
          magicHex,
          byteSize: buf.length,
          loudness,
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      attempts.push({ label, ok: false, error: msg.slice(0, 200) });
      console.warn(`[test-audio] ${label} failed:`, msg.slice(0, 120));
    }
  }

  return {
    transcript: { full_text: "", segments: [] },
    attempts,
    sniff,
    magicHex,
    byteSize: buf.length,
    loudness,
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
          "You analyze screen-recording frames of an expert demonstrating a skill. " +
          "For EACH frame, extract:\n" +
          "- app: application/site (e.g. OpenClu, GitHub, VS Code)\n" +
          "- action: what the user is doing on this screen\n" +
          "- details: one sentence — page/section and intent (not repeated filler)\n" +
          "- visible_text: UI labels, headings, button names, field LABELS, and non-repetitive on-screen hints. " +
          "Do NOT dump entire form values the user typed (title/description text they are entering). " +
          "Do include section names like 'Contribute Data', field labels like 'Title', 'Description', 'Triggers'.\n" +
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

function sanitizeVisibleTextForExtraction(text: string, brief: SkillBriefInput): string {
  const noise = new Set(
    [
      brief.title,
      brief.description,
      brief.skillSlug,
      brief.triggers,
      brief.expertiseSource,
      ...brief.triggers.split("\n"),
    ]
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const kept: string[] = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    const valueOnly = lower.replace(/^(title|description|triggers|expertise source|generated slug):\s*/i, "").trim();
    if (noise.has(lower) || noise.has(valueOnly)) continue;
    if (/^openclu skill record/i.test(line) && line.length < 80) continue;
    kept.push(line);
  }
  return kept.join("\n");
}

function compactFrameAnnotationsForExtraction(
  annotations: FrameAnnotation[],
  brief: SkillBriefInput,
): FrameAnnotation[] {
  const out: FrameAnnotation[] = [];
  let lastSig = "";

  for (const ann of annotations) {
    const visible = sanitizeVisibleTextForExtraction(ann.visible_text ?? "", brief);
    const sig = `${ann.app}|${ann.action}|${visible}`;
    if (sig === lastSig && out.length > 0) continue;
    lastSig = sig;
    out.push({
      ...ann,
      visible_text: visible,
      details:
        ann.details?.length && ann.details.length < 200
          ? ann.details
          : ann.action || "Screen activity",
    });
  }
  return out;
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

function buildBriefContextBlock(brief: SkillBriefInput): string {
  if (briefLooksLikePlaceholder(brief)) {
    return (
      "CONTRIBUTOR FORM (PLACEHOLDER — do NOT copy into skill body or description):\n" +
      `Draft title: "${brief.title.trim()}"\n` +
      `Draft description: "${brief.description.trim()}"\n` +
      "The expert narrated the real skill in the audio transcript below."
    );
  }
  return (
    "Contributor intent (context only — prefer transcript if more detailed):\n" +
    `Title: ${brief.title.trim()}\n` +
    `Description: ${brief.description.trim()}`
  );
}

function buildExtractionPrompt(
  transcript: Transcript,
  frameAnnotations: FrameAnnotation[],
  brief: SkillBriefInput,
  strict = false,
): string {
  const compactFrames = compactFrameAnnotationsForExtraction(frameAnnotations, brief);
  const recordedAt = brief.recordedAt ?? new Date().toISOString();

  if (strict) {
    return SKILL_EXTRACTION_STRICT_RETRY.replace("{brief_title}", brief.title.trim())
      .replace("{brief_description}", brief.description.trim())
      .replace("{transcript}", formatTranscriptForPrompt(transcript))
      .replace("{frame_annotations}", formatFrameAnnotationsForPrompt(compactFrames))
      .replace("{skill_slug}", brief.skillSlug.trim());
  }

  return SKILL_EXTRACTION_PROMPT.replace("{brief_context}", buildBriefContextBlock(brief))
    .replace("{transcript}", formatTranscriptForPrompt(transcript))
    .replace("{frame_annotations}", formatFrameAnnotationsForPrompt(compactFrames))
    .replace("{skill_slug}", brief.skillSlug.trim())
    .replace("{recorded_at}", recordedAt);
}

async function runSkillExtraction(
  transcript: Transcript,
  frameAnnotations: FrameAnnotation[],
  brief: SkillBriefInput,
  strict: boolean,
): Promise<string> {
  const client = getClient();
  const prompt = buildExtractionPrompt(transcript, frameAnnotations, brief, strict);

  const response = await client.chat.completions.create({
    model: TEXT_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You extract concrete, actionable agent skills from screen recordings. " +
          "The spoken audio transcript is the primary source. Never echo draft form placeholder text. " +
          "Always produce Overview and numbered Steps from what the expert said.",
      },
      { role: "user", content: prompt },
    ],
    max_tokens: 4096,
    temperature: strict ? 0.1 : 0.2,
  });

  return response.choices[0]?.message?.content?.trim() ?? "";
}

export async function extractSkillMd(
  transcript: Transcript,
  frameAnnotations: FrameAnnotation[],
  brief: SkillBriefInput,
): Promise<string> {
  let generatedMd = await runSkillExtraction(transcript, frameAnnotations, brief, false);

  const body = generatedMd.match(/^---[\s\S]*?---\r?\n([\s\S]*)$/)?.[1] ?? generatedMd;
  if (skillBodyLooksLikePlaceholderEcho(body, brief, transcript)) {
    console.warn("[process-recording] SKILL extraction echoed placeholder — retrying strict pass");
    generatedMd = await runSkillExtraction(transcript, frameAnnotations, brief, true);
  }

  return generatedMd;
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
  const skillMd = mergeSkillMd(draftSkillMd, generatedMd, brief);

  return { skillMd, transcript, frameAnnotations, audioWarning, videoWarning };
}

/** @deprecated Use processRecordingForSkill */
export const processRecordingFromMp4 = processRecordingForSkill;
