import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { processRecordingForSkill } from "@/lib/groq-skill-processor";
import { buildDraftSkillMd, type SkillBriefInput } from "@/lib/skill-md";
import { makeSkillSlug } from "@/lib/skill-slug";
import type { FrameManifestEntry } from "@/lib/video-ffmpeg";
import {
  cleanupWorkDir,
  createWorkDir,
  readFileBuffer,
  sniffMediaContainerFromPath,
  sniffVideoContainer,
  writeUploadBuffer,
} from "@/lib/video-ffmpeg";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const RECORDING_INLINE_MAX = 20 * 1024 * 1024;

function recordingMimeType(sniffed: ReturnType<typeof sniffVideoContainer>, blobType: string): string {
  if (sniffed === "webm") return "video/webm";
  if (sniffed === "mp4") return "video/mp4";
  if (blobType.includes("webm")) return "video/webm";
  if (blobType.includes("mp4")) return "video/mp4";
  return blobType || "application/octet-stream";
}

async function saveClientFrames(
  workDir: string,
  form: FormData,
): Promise<{ manifest: FrameManifestEntry[]; framePaths: string[] }> {
  const frameFiles = form.getAll("frames").filter((f): f is File => f instanceof File);
  if (frameFiles.length === 0) {
    return { manifest: [], framePaths: [] };
  }

  const framesDir = join(workDir, "frames");
  await mkdir(framesDir, { recursive: true });

  const entries: Array<{ index: number; timestamp: number; file: string; path: string }> = [];

  for (const file of frameFiles) {
    const match = file.name.match(/frame_(\d+)\.jpg$/i);
    const index = match ? Number.parseInt(match[1]!, 10) : entries.length;
    const tsRaw = form.get(`frame_ts_${index}`);
    const timestamp =
      typeof tsRaw === "string" ? Number.parseFloat(tsRaw) : Number.isFinite(index) ? index * 5 : 0;
    const diskName = `frame_${String(index).padStart(4, "0")}.jpg`;
    const path = join(framesDir, diskName);
    await writeFile(path, Buffer.from(await file.arrayBuffer()));
    entries.push({ index, timestamp, file: diskName, path });
  }

  entries.sort((a, b) => a.index - b.index);
  const manifest: FrameManifestEntry[] = entries.map(({ index, timestamp, file }) => ({
    index,
    timestamp,
    file,
  }));
  const framePaths = entries.map((e) => e.path);

  console.log(`[process-recording] Using ${manifest.length} browser-captured frames`);
  return { manifest, framePaths };
}

export async function POST(request: Request) {
  let workDir: string | null = null;

  try {
    const form = await request.formData();
    const video = form.get("video");

    if (!video || !(video instanceof Blob)) {
      return NextResponse.json({ error: "Missing video upload." }, { status: 400 });
    }

    if (video.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `Recording exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit.` },
        { status: 413 },
      );
    }

    const briefRaw = form.get("brief");
    if (typeof briefRaw !== "string") {
      return NextResponse.json({ error: "Missing skill brief metadata." }, { status: 400 });
    }

    let brief: SkillBriefInput;
    try {
      brief = JSON.parse(briefRaw) as SkillBriefInput;
    } catch {
      return NextResponse.json({ error: "Invalid skill brief JSON." }, { status: 400 });
    }

    const title = brief.title?.trim() ?? "";
    const description = brief.description?.trim() ?? "";
    const skillSlug =
      brief.skillSlug?.trim() ||
      (title ? makeSkillSlug(title, "skill") : "");

    if (!title || !description) {
      const missing = [
        !title ? "title" : null,
        !description ? "description" : null,
      ].filter(Boolean);
      return NextResponse.json(
        { error: `Missing required fields: ${missing.join(", ")}.` },
        { status: 400 },
      );
    }

    if (!skillSlug) {
      return NextResponse.json(
        { error: "Could not derive skill slug from title." },
        { status: 400 },
      );
    }

    brief = { ...brief, title, description, skillSlug };

    workDir = await createWorkDir("openclu-recording");
    const uploadBuffer = Buffer.from(await video.arrayBuffer());
    const sniffed = sniffVideoContainer(uploadBuffer);
    const ext =
      sniffed === "webm"
        ? "webm"
        : sniffed === "mp4"
          ? "mp4"
          : video.type.includes("webm")
            ? "webm"
            : "mp4";
    const mimeType = recordingMimeType(sniffed, video.type);
    const videoPath = await writeUploadBuffer(workDir, `recording.${ext}`, uploadBuffer);

    const clientFrames = await saveClientFrames(workDir, form);
    if (clientFrames.framePaths.length === 0) {
      return Response.json(
        {
          error:
            "No screen frames received. The browser must capture JPEG frames before upload (use /record in Chrome or Edge).",
        },
        { status: 400 },
      );
    }

    const hadAudioRaw = form.get("had_audio_tracks");
    const clientHadAudioTracks = hadAudioRaw === "true";

    let narrationAudioPath: string | undefined;
    const narrationBlob = form.get("narration_audio");
    if (narrationBlob instanceof Blob && narrationBlob.size > 256) {
      const narrBuffer = Buffer.from(await narrationBlob.arrayBuffer());
      const narrSniff = sniffVideoContainer(narrBuffer);
      const narrExt =
        narrSniff === "mp4" ? "m4a" : narrSniff === "webm" ? "webm" : "webm";
      narrationAudioPath = await writeUploadBuffer(workDir, `narration.${narrExt}`, narrBuffer);
      const narrOnDisk = await sniffMediaContainerFromPath(narrationAudioPath);
      const head = narrBuffer.subarray(0, 4);
      console.log(
        `[process-recording] narration sidecar ${(narrationBlob.size / 1024).toFixed(1)} KB ` +
          `type=${narrationBlob.type || "unknown"} sniff=${narrOnDisk} ` +
          `magic=${head.length >= 4 ? head.toString("hex") : "short"}`,
      );
      if (narrOnDisk !== "webm" && narrOnDisk !== "mp4") {
        console.warn(
          "[process-recording] narration file is not a valid WebM/MP4 container — transcription will likely fail",
        );
      }
    }

    const draftSkillMd = buildDraftSkillMd(brief);
    const result = await processRecordingForSkill(
      videoPath,
      workDir,
      draftSkillMd,
      clientFrames,
      brief,
      { clientHadAudioTracks, narrationAudioPath },
    );

    console.log(
      `[process-recording] transcript segments=${result.transcript.segments.length} ` +
        `chars=${result.transcript.full_text.length} frames=${result.frameAnnotations.length} ` +
        `narration=${narrationAudioPath ? "yes" : "no"}`,
    );
    const recordingBuffer = await readFileBuffer(videoPath);

    return NextResponse.json({
      ok: true,
      skillMd: result.skillMd,
      transcript: result.transcript,
      frameAnnotations: result.frameAnnotations,
      audioWarning: result.audioWarning,
      videoWarning: result.videoWarning,
      recording:
        recordingBuffer.length <= RECORDING_INLINE_MAX
          ? {
              base64: recordingBuffer.toString("base64"),
              mimeType,
              byteLength: recordingBuffer.length,
            }
          : {
              tooLarge: true,
              mimeType,
              byteLength: recordingBuffer.length,
            },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Processing failed.";
    console.error("[process-recording]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (workDir) await cleanupWorkDir(workDir);
  }
}
