/** Capture JPEG frames from a live preview or recording blob. */

export type ClientCapturedFrame = {
  index: number;
  timestamp: number;
  blob: Blob;
};

import { FRAME_INTERVAL_SEC, MAX_FRAMES } from "@/lib/recording-constants";

export { FRAME_INTERVAL_SEC, MAX_FRAMES };

export async function captureJpegFromVideoElement(video: HTMLVideoElement): Promise<Blob> {
  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  if (!srcW || !srcH) {
    throw new Error("Video frame has no dimensions yet — wait a moment and try again.");
  }
  const scale = Math.min(1, 1920 / srcW);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(srcW * scale));
  canvas.height = Math.max(1, Math.round(srcH * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available.");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Failed to encode frame JPEG."))),
      "image/jpeg",
      0.82,
    );
  });
}

/** One snapshot from the live preview (cannot rewind a live stream). */
export async function captureLivePreviewFrame(
  video: HTMLVideoElement | null,
  timestampSec: number,
  index: number,
): Promise<ClientCapturedFrame | null> {
  if (!video?.srcObject || video.readyState < 2) return null;
  if (!video.videoWidth || !video.videoHeight) return null;
  try {
    const blob = await captureJpegFromVideoElement(video);
    return { index, timestamp: timestampSec, blob };
  } catch {
    return null;
  }
}

async function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 1 && video.videoWidth > 0) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Recording preview timed out.")), 20_000);
    const done = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    video.onloadedmetadata = done;
    video.onloadeddata = done;
    video.onerror = () => {
      window.clearTimeout(timeout);
      reject(
        new Error(
          "Could not decode the recording file in this browser. Frames should be captured during recording instead.",
        ),
      );
    };
  });
}

async function seekTo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  const target = Math.max(0, Math.min(timeSec, Math.max(0, video.duration - 0.05)));
  if (Math.abs(video.currentTime - target) < 0.05) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Frame seek timed out.")), 15_000);
    const onSeeked = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = target;
  });
}

/** Fallback: extract frames from a finished recording blob (often fails on Windows WebM). */
export async function extractFramesFromRecordingBlob(
  videoBlob: Blob,
): Promise<{ frames: ClientCapturedFrame[]; duration: number }> {
  const typesToTry = [
    videoBlob.type,
    "video/webm",
    "video/mp4",
    "video/webm;codecs=vp8",
    "video/webm;codecs=vp9",
  ].filter((t, i, a) => t && a.indexOf(t) === i);

  let lastError: Error | null = null;
  for (const type of typesToTry) {
    const typedBlob = type === videoBlob.type ? videoBlob : new Blob([videoBlob], { type });
    const url = URL.createObjectURL(typedBlob);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;

    try {
      await waitForMetadata(video);
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        await video.play().catch(() => undefined);
        await new Promise<void>((resolve) => {
          const onTime = () => {
            if (video.currentTime > 0.2 && Number.isFinite(video.duration) && video.duration > 0) {
              video.pause();
              video.removeEventListener("timeupdate", onTime);
              resolve();
            }
          };
          video.addEventListener("timeupdate", onTime);
          window.setTimeout(() => {
            video.pause();
            resolve();
          }, 8_000);
        });
      }

      const duration =
        Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      const timestamps: number[] = duration > 0 ? [0] : [0];
      for (
        let t = FRAME_INTERVAL_SEC;
        t < duration && timestamps.length < MAX_FRAMES;
        t += FRAME_INTERVAL_SEC
      ) {
        timestamps.push(t);
      }

      const frames: ClientCapturedFrame[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        await seekTo(video, timestamps[i]!);
        const blob = await captureJpegFromVideoElement(video);
        frames.push({ index: i, timestamp: timestamps[i]!, blob });
      }

      if (frames.length > 0) {
        return { frames, duration };
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    } finally {
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    }
  }

  throw (
    lastError ??
    new Error("Could not decode the recording for frame capture.")
  );
}
