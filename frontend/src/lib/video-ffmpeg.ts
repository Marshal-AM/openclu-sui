import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { resolveFfmpegBinary } from "@/lib/ffmpeg-binary";

const execFileAsync = promisify(execFile);

import { FRAME_INTERVAL_SEC, MAX_FRAMES } from "@/lib/recording-constants";

export { FRAME_INTERVAL_SEC };
export { resolveFfmpegBinary, isFfmpegMissingError } from "@/lib/ffmpeg-binary";

export type FrameManifestEntry = {
  index: number;
  timestamp: number;
  file: string;
};

async function runFfmpeg(args: string[]): Promise<void> {
  const bin = await resolveFfmpegBinary();
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
  const bin = await resolveFfmpegBinary();
  try {
    await execFileAsync(bin, ["-i", mediaPath], { maxBuffer: 16 * 1024 * 1024 });
    return { hasVideo: false, hasAudio: false };
  } catch (err: unknown) {
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr: Buffer | string }).stderr)
        : "";
    const hasAudio =
      /Audio:/i.test(stderr) ||
      /\bopus\b/i.test(stderr) ||
      /\bvorbis\b/i.test(stderr) ||
      /\bpcm_/i.test(stderr) ||
      /Stream #\d+:\d+.*Audio/i.test(stderr);
    return {
      hasVideo: /Video:/i.test(stderr),
      hasAudio,
    };
  }
}

/** Browser WebM often omits Audio: in ffmpeg stderr; try extracting a few seconds of audio. */
export async function probeAudioByExtraction(
  mediaPath: string,
  workDir: string,
): Promise<boolean> {
  const outPath = join(workDir, "probe-audio.mp3");
  try {
    await runFfmpeg([
      "-y",
      "-i",
      mediaPath,
      "-vn",
      "-t",
      "30",
      "-acodec",
      "libmp3lame",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-b:a",
      "64k",
      outPath,
    ]);
    const buf = await readFile(outPath);
    return buf.length > 500;
  } catch {
    return false;
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

export async function sniffMediaContainerFromPath(filePath: string): Promise<VideoContainer> {
  const buf = await readFile(filePath);
  return sniffVideoContainer(buf.subarray(0, Math.min(buf.length, 64)));
}

/** Convert browser WebM/MP4 (screen or narration sidecar) to MP3/WAV for Whisper. */
export async function extractAudioForTranscription(
  mediaPath: string,
  outputPath: string,
): Promise<void> {
  const container = await sniffMediaContainerFromPath(mediaPath);
  const toWav = outputPath.endsWith(".wav");
  const outputCodec = toWav
    ? ["-acodec", "pcm_s16le"]
    : ["-acodec", "libmp3lame", "-b:a", "96k"];
  const tail = ["-ar", "16000", "-ac", "1", ...outputCodec, outputPath];

  const variants: string[][] = [];

  if (container === "webm") {
    variants.push(["-f", "webm", "-i", mediaPath, "-vn", ...tail]);
    variants.push(["-f", "matroska", "-i", mediaPath, "-vn", ...tail]);
  } else if (container === "mp4") {
    variants.push(["-f", "mp4", "-i", mediaPath, "-vn", ...tail]);
  }

  variants.push(["-i", mediaPath, "-vn", ...tail]);
  variants.push([
    "-fflags",
    "+genpts+igndts",
    "-err_detect",
    "ignore_err",
    "-i",
    mediaPath,
    "-vn",
    ...tail,
  ]);

  // Audio-only sidecars may not need -vn
  if (container === "webm" || container === "unknown") {
    variants.push(["-f", "webm", "-i", mediaPath, ...tail]);
    variants.push(["-i", mediaPath, ...tail]);
  }

  let lastErr: unknown;
  for (const args of variants) {
    try {
      await runFfmpeg(["-y", ...args]);
      const out = await readFile(outputPath);
      if (out.length > 400) return;
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error("Could not extract audio from recording for transcription.");
}

export async function readFileBuffer(path: string): Promise<Buffer> {
  return readFile(path);
}

export type AudioLoudnessStats = {
  meanVolumeDb: number | null;
  maxVolumeDb: number | null;
  /** True when ffmpeg reports extremely quiet audio (likely noise-only for Whisper). */
  likelySilent: boolean;
};

/** Parse ffmpeg volumedetect stderr — useful to confirm Mac uploads contain speech. */
export async function measureAudioLoudness(mediaPath: string): Promise<AudioLoudnessStats> {
  const bin = await resolveFfmpegBinary();
  try {
    await execFileAsync(
      bin,
      ["-hide_banner", "-i", mediaPath, "-af", "volumedetect", "-f", "null", "-"],
      { maxBuffer: 8 * 1024 * 1024 },
    );
  } catch (err: unknown) {
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr: Buffer | string }).stderr)
        : "";
    const meanMatch = stderr.match(/mean_volume:\s*([-\d.]+)\s*dB/i);
    const maxMatch = stderr.match(/max_volume:\s*([-\d.]+)\s*dB/i);
    const meanVolumeDb = meanMatch ? Number.parseFloat(meanMatch[1]!) : null;
    const maxVolumeDb = maxMatch ? Number.parseFloat(maxMatch[1]!) : null;
    const likelySilent =
      maxVolumeDb !== null && maxVolumeDb < -45 && (meanVolumeDb === null || meanVolumeDb < -50);
    return { meanVolumeDb, maxVolumeDb, likelySilent };
  }
  return { meanVolumeDb: null, maxVolumeDb: null, likelySilent: false };
}

export async function writeUploadBuffer(dir: string, name: string, data: Buffer): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, data);
  return path;
}

/** Read a browser-captured JPEG and base64-encode it, recompressing with ffmpeg if too large. */
export async function readJpegAsBase64(path: string, maxKb: number): Promise<string> {
  let buf = await readFile(path);
  if (buf.length / 1024 <= maxKb) {
    return buf.toString("base64");
  }

  const tmpOut = join(tmpdir(), `openclu-jpeg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`);
  try {
    let scale = 0.85;
    let qv = 4;
    for (let attempt = 0; attempt < 8; attempt++) {
      await runFfmpeg([
        "-y",
        "-i",
        path,
        "-vf",
        `scale='min(${Math.max(320, Math.round(1920 * scale))},iw)':-2`,
        "-q:v",
        String(Math.min(qv, 20)),
        tmpOut,
      ]);
      buf = await readFile(tmpOut);
      if (buf.length / 1024 <= maxKb || qv >= 18) break;
      scale *= 0.85;
      qv += 2;
    }
    return buf.toString("base64");
  } finally {
    await rm(tmpOut, { force: true }).catch(() => undefined);
  }
}
