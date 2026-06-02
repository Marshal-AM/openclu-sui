import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";

const execFileAsync = promisify(execFile);

import { FRAME_INTERVAL_SEC, MAX_FRAMES } from "@/lib/recording-constants";

export { FRAME_INTERVAL_SEC };

export type FrameManifestEntry = {
  index: number;
  timestamp: number;
  file: string;
};

function requireFfmpeg(): string {
  if (!ffmpegPath) {
    throw new Error(
      "ffmpeg binary not found. Reinstall dependencies (ffmpeg-static) and restart the dev server.",
    );
  }
  return ffmpegPath;
}

async function runFfmpeg(args: string[]): Promise<void> {
  const bin = requireFfmpeg();
  await execFileAsync(bin, args, { maxBuffer: 32 * 1024 * 1024 });
}

export type VideoContainer = "webm" | "mp4" | "unknown";

/** Detect container from file magic bytes (MIME type from the browser is often wrong). */
export function sniffVideoContainer(data: Buffer | Uint8Array): VideoContainer {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length < 4) return "unknown";
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return "webm";
  }
  if (buf.length >= 8 && buf.subarray(4, 8).toString("ascii") === "ftyp") {
    return "mp4";
  }
  if (buf.subarray(0, 4).toString("ascii") === "ftyp") {
    return "mp4";
  }
  return "unknown";
}

/** ffmpeg -i exits non-zero; stream info is written to stderr. */
export async function probeMediaStreams(
  mediaPath: string,
): Promise<{ hasVideo: boolean; hasAudio: boolean }> {
  const bin = requireFfmpeg();
  try {
    await execFileAsync(bin, ["-i", mediaPath], { maxBuffer: 16 * 1024 * 1024 });
    return { hasVideo: false, hasAudio: false };
  } catch (err: unknown) {
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr: Buffer | string }).stderr)
        : "";
    return {
      hasVideo: /Video:/i.test(stderr),
      hasAudio: /Audio:/i.test(stderr),
    };
  }
}

export async function createWorkDir(prefix: string): Promise<string> {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function cleanupWorkDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

export async function extractFrames(
  videoPath: string,
  framesDir: string,
): Promise<{ manifest: FrameManifestEntry[]; framePaths: string[] }> {
  await mkdir(framesDir, { recursive: true });
  const pattern = join(framesDir, "frame_%04d.jpg");

  await runFfmpeg([
    "-y",
    "-i",
    videoPath,
    "-vf",
    `fps=1/${FRAME_INTERVAL_SEC},scale='min(1920,iw)':-2`,
    "-q:v",
    "3",
    "-frames:v",
    String(MAX_FRAMES),
    pattern,
  ]);

  const files = (await readdir(framesDir))
    .filter((f) => f.startsWith("frame_") && f.endsWith(".jpg"))
    .sort();

  const manifest: FrameManifestEntry[] = files.map((file, index) => ({
    index,
    timestamp: index * FRAME_INTERVAL_SEC,
    file,
  }));

  return {
    manifest,
    framePaths: files.map((f) => join(framesDir, f)),
  };
}

export async function extractAudioForTranscription(
  videoPath: string,
  outputPath: string,
): Promise<void> {
  await runFfmpeg([
    "-y",
    "-i",
    videoPath,
    "-vn",
    "-acodec",
    "libmp3lame",
    "-ar",
    "44100",
    "-ac",
    "1",
    "-b:a",
    "96k",
    outputPath,
  ]);
}

export async function readFileBuffer(path: string): Promise<Buffer> {
  return readFile(path);
}

export async function writeUploadBuffer(dir: string, name: string, data: Buffer): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, data);
  return path;
}
