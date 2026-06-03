/**
 * Browser screen capture via Display Media API + MediaRecorder.
 * Requires a secure context (https:// or http://localhost / 127.0.0.1).
 *
 * Pattern (matches typical OpenClu-style capture):
 * - Screen recorder: video only (no mic muxed into WebM — unreliable on Windows)
 * - Narration recorder: dedicated mic stream (or tab audio), audio-only WebM/MP4
 * - No timeslice / no track.clone() — both produce invalid WebM on Edge
 * - Mac: prefer audio/mp4 + mac-friendly constraints (less aggressive noise suppression)
 */

import {
  attachMicLevelMonitor,
  getMicAudioConstraints,
  isApplePlatform,
  type MicCaptureProfile,
  type MicLevelMonitor,
} from "@/lib/mic-audio-utils";

export type ScreenRecorderStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "stopping"
  | "processing";

export type RecordingAudioCapture = {
  displayAudio: boolean;
  microphone: boolean;
  source: "microphone" | "display" | "none";
  narrationSidecar: boolean;
  mimeType: string;
};

export type ScreenCaptureDiagnostics = {
  supported: boolean;
  reason: string | null;
  isSecureContext: boolean;
  hostname: string;
  hasMediaDevices: boolean;
  hasGetDisplayMedia: boolean;
  hasMediaRecorder: boolean;
};

export class ScreenRecorderError extends Error {
  constructor(
    message: string,
    readonly code: "unsupported" | "denied" | "aborted" | "failed",
  ) {
    super(message);
    this.name = "ScreenRecorderError";
  }
}

export type RecordingBlobs = {
  video: Blob;
  narration: Blob | null;
};

const WEBM_EBML = [0x1a, 0x45, 0xdf, 0xa3] as const;

export async function blobHasWebmHeader(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  return WEBM_EBML.every((byte, i) => head[i] === byte);
}

export type RecordingBlobDiagnostics = {
  byteSize: number;
  mimeType: string;
  hasWebmHeader: boolean;
  magicHex: string;
  platform: string;
  userAgent: string;
};

export async function describeRecordingBlob(blob: Blob): Promise<RecordingBlobDiagnostics> {
  const head = new Uint8Array(await blob.slice(0, Math.min(8, blob.size)).arrayBuffer());
  const magicHex = [...head].map((b) => b.toString(16).padStart(2, "0")).join("");
  const diag: RecordingBlobDiagnostics = {
    byteSize: blob.size,
    mimeType: blob.type || "unknown",
    hasWebmHeader: await blobHasWebmHeader(blob),
    magicHex: magicHex || "empty",
    platform: typeof navigator !== "undefined" ? navigator.platform : "",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
  };
  console.info("[screen-recorder] blob diagnostics", diag);
  return diag;
}

export type MicRecorderDiagnostics = {
  supportedMimeTypes: string[];
  chosenMimeType: string | null;
  platform: string;
  userAgent: string;
};

export function getMicRecorderDiagnostics(): MicRecorderDiagnostics {
  const supportedMimeTypes = AUDIO_RECORDER_MIME_CANDIDATES.filter((m) =>
    MediaRecorder.isTypeSupported(m),
  );
  const diag: MicRecorderDiagnostics = {
    supportedMimeTypes: [...supportedMimeTypes],
    chosenMimeType: pickAudioOnlyMimeType() ?? null,
    platform: navigator.platform,
    userAgent: navigator.userAgent,
  };
  console.info("[screen-recorder] mic diagnostics", diag);
  return diag;
}

export type MicTestOptions = {
  deviceId?: string;
  profile?: MicCaptureProfile;
};

export type MicTestSession = {
  micStream: MediaStream;
  recorder: MediaRecorder;
  mimeType: string;
  trackLabel: string;
  trackSettings: MediaTrackSettings;
  profile: MicCaptureProfile;
  levelMonitor: MicLevelMonitor;
};

export async function startMicTestRecording(options?: MicTestOptions): Promise<MicTestSession> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new ScreenRecorderError("Microphone API is not available.", "unsupported");
  }

  const profile =
    options?.profile ?? (isApplePlatform() ? "mac-friendly" : "default");

  const micStream = await navigator.mediaDevices.getUserMedia({
    audio: getMicAudioConstraints(profile, options?.deviceId),
    video: false,
  });

  const track = micStream.getAudioTracks()[0];
  if (!track || track.readyState !== "live") {
    micStream.getTracks().forEach((t) => t.stop());
    throw new ScreenRecorderError("No live microphone track.", "failed");
  }

  if (track.muted) {
    console.warn("[screen-recorder] mic track reports muted=true");
  }

  const settings = track.getSettings();
  const levelMonitor = attachMicLevelMonitor(micStream);
  console.info("[screen-recorder] mic test track", {
    label: track.label,
    muted: track.muted,
    enabled: track.enabled,
    settings,
    profile,
    isApple: isApplePlatform(),
    diagnostics: getMicRecorderDiagnostics(),
  });

  const sidecar = startNarrationRecorder(micStream);
  if (!sidecar) {
    levelMonitor.stop();
    micStream.getTracks().forEach((t) => t.stop());
    throw new ScreenRecorderError("Could not start microphone recorder.", "failed");
  }

  return {
    micStream,
    recorder: sidecar.recorder,
    mimeType: sidecar.mimeType,
    trackLabel: track.label,
    trackSettings: settings,
    profile,
    levelMonitor,
  };
}

export async function stopMicTestRecording(
  session: MicTestSession,
): Promise<{
  blob: Blob;
  diagnostics: RecordingBlobDiagnostics;
  levelSnapshot: ReturnType<MicLevelMonitor["getSnapshot"]>;
}> {
  const levelSnapshot = session.levelMonitor.getSnapshot();
  session.levelMonitor.stop();
  const blob = await stopMediaRecorder(session.recorder, session.mimeType);
  session.micStream.getTracks().forEach((t) => t.stop());
  const diagnostics = await describeRecordingBlob(blob);
  console.info("[screen-recorder] mic test stop", { levelSnapshot, diagnostics });
  return { blob, diagnostics, levelSnapshot };
}

function resolveGetDisplayMedia():
  | ((constraints?: DisplayMediaStreamOptions) => Promise<MediaStream>)
  | null {
  if (typeof navigator === "undefined") return null;

  const mediaDevices = navigator.mediaDevices;
  if (mediaDevices?.getDisplayMedia) {
    return (constraints) => mediaDevices.getDisplayMedia(constraints);
  }

  const legacy = (
    navigator as Navigator & {
      getDisplayMedia?: (constraints?: DisplayMediaStreamOptions) => Promise<MediaStream>;
    }
  ).getDisplayMedia;
  if (legacy) {
    return (constraints) => legacy.call(navigator, constraints);
  }

  return null;
}

export function getScreenCaptureDiagnostics(): ScreenCaptureDiagnostics {
  if (typeof window === "undefined") {
    return {
      supported: false,
      reason: null,
      isSecureContext: false,
      hostname: "",
      hasMediaDevices: false,
      hasGetDisplayMedia: false,
      hasMediaRecorder: false,
    };
  }

  const isSecureContext = window.isSecureContext;
  const hostname = window.location.hostname;
  const hasMediaDevices = !!navigator.mediaDevices;
  const hasGetDisplayMedia = resolveGetDisplayMedia() !== null;
  const hasMediaRecorder = typeof MediaRecorder !== "undefined";

  let reason: string | null = null;

  if (!isSecureContext) {
    reason =
      `Screen recording needs a secure page. You are on “${window.location.origin}”. ` +
      `Open http://localhost:3000/record in Edge (not a LAN IP like 192.168.x.x).`;
  } else if (!hasGetDisplayMedia) {
    reason =
      "Screen capture API is missing. Open this app in full Microsoft Edge (not an embedded IDE browser), then use http://localhost:3000/record.";
  } else if (!hasMediaRecorder) {
    reason = "MediaRecorder is not available in this browser.";
  }

  const supported = isSecureContext && hasGetDisplayMedia && hasMediaRecorder;

  return {
    supported,
    reason,
    isSecureContext,
    hostname,
    hasMediaDevices,
    hasGetDisplayMedia,
    hasMediaRecorder,
  };
}

export function isScreenCaptureSupported(): boolean {
  return getScreenCaptureDiagnostics().supported;
}

function pickVideoMimeType(): string | undefined {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  for (const mimeType of candidates) {
    if (MediaRecorder.isTypeSupported(mimeType)) return mimeType;
  }
  return undefined;
}

const AUDIO_RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/aac",
] as const;

function pickAudioOnlyMimeType(): string | undefined {
  const candidates = isApplePlatform()
    ? (["audio/mp4", ...AUDIO_RECORDER_MIME_CANDIDATES] as const)
    : AUDIO_RECORDER_MIME_CANDIDATES;
  for (const mimeType of candidates) {
    if (MediaRecorder.isTypeSupported(mimeType)) return mimeType;
  }
  return undefined;
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes("mp4")) return "mp4";
  return "webm";
}

export type ScreenRecordingSession = {
  /** Video-only stream for preview + screen MediaRecorder */
  stream: MediaStream;
  micStream: MediaStream | null;
  recorder: MediaRecorder;
  mimeType: string;
  audioCapture: RecordingAudioCapture;
  narrationRecorder: MediaRecorder | null;
  narrationStream: MediaStream | null;
  narrationMimeType: string | null;
};

function startNarrationRecorder(narrationStream: MediaStream): {
  recorder: MediaRecorder;
  mimeType: string;
} | null {
  const tracks = narrationStream.getAudioTracks();
  if (!tracks.length || tracks[0]?.readyState !== "live") return null;

  try {
    const mimeType = pickAudioOnlyMimeType();
    const recorder = mimeType
      ? new MediaRecorder(narrationStream, { mimeType, audioBitsPerSecond: 128_000 })
      : new MediaRecorder(narrationStream);
    const finalMime = recorder.mimeType || mimeType || "audio/webm";
    recorder.start();
    return { recorder, mimeType: finalMime };
  } catch (err) {
    console.warn("[screen-recorder] Could not start narration recorder:", err);
    return null;
  }
}

export async function startScreenRecording(): Promise<ScreenRecordingSession> {
  const diagnostics = getScreenCaptureDiagnostics();
  if (!diagnostics.supported) {
    throw new ScreenRecorderError(
      diagnostics.reason ??
        "Screen recording is not available. Use http://localhost:3000 in Edge, Chrome, or Firefox.",
      "unsupported",
    );
  }

  const getDisplayMedia = resolveGetDisplayMedia()!;

  let displayStream: MediaStream;
  try {
    displayStream = await getDisplayMedia({
      video: true,
      audio: true,
    });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      throw new ScreenRecorderError(
        "Screen sharing was blocked. Allow screen capture when prompted.",
        "denied",
      );
    }
    if (name === "AbortError") {
      throw new ScreenRecorderError("Screen sharing was cancelled.", "aborted");
    }
    throw new ScreenRecorderError(
      err instanceof Error ? err.message : "Could not start screen capture.",
      "failed",
    );
  }

  const displayHasAudio = displayStream.getAudioTracks().length > 0;
  const displayAudioTrack = displayStream.getAudioTracks()[0] ?? null;

  let micStream: MediaStream | null = null;
  let micDenied = false;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: getMicAudioConstraints(isApplePlatform() ? "mac-friendly" : "default"),
      video: false,
    });
  } catch {
    micDenied = true;
  }

  const micTrack = micStream?.getAudioTracks()[0] ?? null;

  let audioSource: RecordingAudioCapture["source"] = "none";
  let narrationStream: MediaStream | null = null;

  if (micTrack && micTrack.readyState === "live") {
    audioSource = "microphone";
    narrationStream = micStream;
  } else if (displayAudioTrack && displayAudioTrack.readyState === "live") {
    audioSource = "display";
    narrationStream = new MediaStream([displayAudioTrack]);
  }

  const videoStream = new MediaStream(displayStream.getVideoTracks());
  if (videoStream.getVideoTracks().length === 0) {
    displayStream.getTracks().forEach((t) => t.stop());
    micStream?.getTracks().forEach((t) => t.stop());
    throw new ScreenRecorderError("No video track in screen share.", "failed");
  }

  const videoMime = pickVideoMimeType();
  let recorder: MediaRecorder;
  try {
    recorder = videoMime
      ? new MediaRecorder(videoStream, { mimeType: videoMime, videoBitsPerSecond: 2_500_000 })
      : new MediaRecorder(videoStream);
  } catch {
    videoStream.getTracks().forEach((t) => t.stop());
    micStream?.getTracks().forEach((t) => t.stop());
    throw new ScreenRecorderError("Could not initialize the screen recorder.", "failed");
  }

  const finalMime = recorder.mimeType || videoMime || "video/webm";

  let narrationRecorder: MediaRecorder | null = null;
  let narrationMimeType: string | null = null;
  let narrationSidecar = false;

  if (narrationStream) {
    const sidecar = startNarrationRecorder(narrationStream);
    if (sidecar) {
      narrationRecorder = sidecar.recorder;
      narrationMimeType = sidecar.mimeType;
      narrationSidecar = true;
    }
  }

  const audioCapture: RecordingAudioCapture = {
    displayAudio: displayHasAudio,
    microphone: !!micTrack,
    source: audioSource,
    narrationSidecar,
    mimeType: finalMime,
  };

  if (audioSource === "none" || !narrationSidecar) {
    videoStream.getTracks().forEach((t) => t.stop());
    micStream?.getTracks().forEach((t) => t.stop());
    throw new ScreenRecorderError(
      micDenied
        ? "No audio could be captured. Allow microphone access when prompted, and optionally enable “Share system audio” in the screen picker."
        : "Could not start the voice recorder. Allow microphone access and try again.",
      "failed",
    );
  }

  recorder.start();

  return {
    stream: videoStream,
    micStream,
    recorder,
    mimeType: finalMime,
    audioCapture,
    narrationRecorder,
    narrationStream,
    narrationMimeType,
  };
}

function stopMediaRecorder(recorder: MediaRecorder, fallbackMime: string): Promise<Blob> {
  const chunks: Blob[] = [];
  const mimeType = () => recorder.mimeType || fallbackMime;

  return new Promise((resolve, reject) => {
    const buildBlob = (): Blob => new Blob(chunks, { type: mimeType() });

    recorder.ondataavailable = (event) => {
      chunks.push(event.data);
    };

    recorder.onerror = () => {
      reject(new ScreenRecorderError("Recording failed.", "failed"));
    };

    recorder.onstop = () => {
      const nonEmpty = chunks.filter((c) => c.size > 0);
      const merged = nonEmpty.length > 0 ? nonEmpty : chunks;
      if (merged.length === 0) {
        reject(new ScreenRecorderError("No recording data was captured.", "failed"));
        return;
      }
      resolve(new Blob(merged, { type: mimeType() }));
    };

    if (recorder.state === "inactive") {
      const nonEmpty = chunks.filter((c) => c.size > 0);
      if (nonEmpty.length === 0) {
        reject(new ScreenRecorderError("No recording data was captured.", "failed"));
      } else {
        resolve(new Blob(nonEmpty, { type: mimeType() }));
      }
      return;
    }

    void (async () => {
      try {
        if (recorder.state === "recording") {
          await new Promise<void>((resolveData) => {
            const timeout = window.setTimeout(() => resolveData(), 3_000);
            recorder.addEventListener(
              "dataavailable",
              () => {
                window.clearTimeout(timeout);
                resolveData();
              },
              { once: true },
            );
            recorder.requestData();
          });
        }
        recorder.stop();
      } catch (err) {
        reject(
          err instanceof Error
            ? new ScreenRecorderError(err.message, "failed")
            : new ScreenRecorderError("Could not stop recording.", "failed"),
        );
      }
    })();
  });
}

function stopAllSessionTracks(session: ScreenRecordingSession): void {
  session.stream.getTracks().forEach((track) => track.stop());
  if (session.narrationStream && session.narrationStream !== session.micStream) {
    session.narrationStream.getTracks().forEach((track) => track.stop());
  }
  session.micStream?.getTracks().forEach((track) => track.stop());
}

export function stopScreenRecording(session: ScreenRecordingSession): Promise<RecordingBlobs> {
  const { recorder, narrationRecorder, narrationMimeType } = session;

  const stopNarration =
    narrationRecorder && narrationMimeType
      ? stopMediaRecorder(narrationRecorder, narrationMimeType)
      : Promise.resolve(null);

  return stopNarration
    .then(async (narration) => {
      const video = await stopMediaRecorder(recorder, session.mimeType);
      stopAllSessionTracks(session);

      let narrationOut: Blob | null =
        narration && narration.size > 256 ? narration : null;

      if (narrationOut) {
        const narrDiag = await describeRecordingBlob(narrationOut);
        if (!narrDiag.hasWebmHeader && !narrationOut.type.includes("mp4")) {
          console.warn("[screen-recorder] Narration blob missing WebM header", narrDiag);
          narrationOut = null;
        }
      }

      if (video.size > 256 && !(await blobHasWebmHeader(video))) {
        console.warn("[screen-recorder] Video blob missing WebM header; size=", video.size);
      }

      return { video, narration: narrationOut };
    })
    .catch((err) => {
      stopAllSessionTracks(session);
      throw err;
    });
}

export function downloadRecording(blob: Blob, filenameBase: string): void {
  const ext = extensionForMime(blob.type);
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

export function attachStreamEndedHandler(
  stream: MediaStream,
  onEnded: () => void,
): () => void {
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) return () => undefined;

  const handleEnded = () => onEnded();
  videoTrack.addEventListener("ended", handleEnded);
  return () => videoTrack.removeEventListener("ended", handleEnded);
}

export function describeAudioCapture(capture: RecordingAudioCapture): string {
  if (capture.source === "microphone") {
    return capture.narrationSidecar
      ? "Microphone (dedicated voice track)"
      : "Microphone";
  }
  if (capture.source === "display") {
    return capture.narrationSidecar ? "Tab/system audio" : "Screen audio";
  }
  return "No audio";
}
