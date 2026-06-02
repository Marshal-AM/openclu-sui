import type { FrameAnnotation, SkillBriefInput, Transcript } from "@/lib/skill-md";
import type { ClientCapturedFrame } from "@/lib/extract-frames-client";
import { extractFramesFromRecordingBlob } from "@/lib/extract-frames-client";

export type ProcessRecordingResponse = {
  ok: true;
  skillMd: string;
  transcript: Transcript;
  frameAnnotations: FrameAnnotation[];
  audioWarning?: string | null;
  videoWarning?: string | null;
  /** Optional local download only — not uploaded to Walrus on publish */
  recording?: {
    base64?: string;
    tooLarge?: boolean;
    mimeType: string;
    byteLength: number;
  };
};

function appendFramesToForm(form: FormData, frames: ClientCapturedFrame[]): void {
  for (const frame of frames) {
    const name = `frame_${String(frame.index).padStart(4, "0")}.jpg`;
    form.append("frames", frame.blob, name);
    form.append(`frame_ts_${frame.index}`, String(frame.timestamp));
  }
}

export async function uploadRecordingForSkill(
  video: Blob,
  brief: SkillBriefInput,
  options?: { frames?: ClientCapturedFrame[] },
): Promise<ProcessRecordingResponse> {
  if (video.size < 512) {
    throw new Error("Recording is empty or too small. Record for at least a few seconds, then stop.");
  }

  let frames = options?.frames ?? [];
  if (frames.length === 0) {
    try {
      ({ frames } = await extractFramesFromRecordingBlob(video));
    } catch {
      throw new Error(
        "Could not capture screen frames. Record for at least a few seconds on http://localhost:3000/record in Chrome or Edge, keep the preview visible, then stop.",
      );
    }
  }

  if (frames.length === 0) {
    throw new Error("No screen frames were captured. Record longer or try a different browser.");
  }

  const form = new FormData();
  const ext = video.type.includes("webm") ? "webm" : video.type.includes("mp4") ? "mp4" : "webm";
  form.append("video", video, `recording.${ext}`);
  form.append("brief", JSON.stringify(brief));
  appendFramesToForm(form, frames);

  const res = await fetch("/api/skills/process-recording", {
    method: "POST",
    body: form,
  });

  const data = (await res.json().catch(() => ({}))) as ProcessRecordingResponse & {
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? `Processing failed (${res.status})`);
  }

  return data;
}

export function downloadRecordingBase64(
  base64: string,
  mimeType: string,
  filenameBase: string,
): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ext = mimeType.includes("webm") ? "webm" : mimeType.includes("mp4") ? "mp4" : "bin";
  const blob = new Blob([bytes], { type: mimeType });
  const safeBase =
    filenameBase
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "screen-recording";
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeBase}-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`;
  anchor.click();
  URL.revokeObjectURL(url);
}
