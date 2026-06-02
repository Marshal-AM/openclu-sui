/**
 * Browser screen capture via Display Media API + MediaRecorder.
 * Requires a secure context (https:// or http://localhost / 127.0.0.1).
 */

export type ScreenRecorderStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "stopping"
  | "processing";

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

function pickRecorderMimeType(): string | undefined {
  // Prefer WebM: browser MP4 from MediaRecorder is often fragmented and breaks server ffmpeg.
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm",
    "video/mp4;codecs=avc1,mp4a",
    "video/mp4",
  ];
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
  stream: MediaStream;
  recorder: MediaRecorder;
  mimeType: string;
};

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

  let stream: MediaStream;
  try {
    const displayStream = await getDisplayMedia({ video: true, audio: true });

    if (displayStream.getAudioTracks().length === 0) {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        stream = new MediaStream([
          ...displayStream.getVideoTracks(),
          ...micStream.getAudioTracks(),
        ]);
      } catch {
        stream = displayStream;
      }
    } else {
      stream = displayStream;
    }
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

  const mimeType = pickRecorderMimeType();
  let recorder: MediaRecorder;
  try {
    recorder = mimeType
      ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 })
      : new MediaRecorder(stream);
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    throw new ScreenRecorderError("Could not initialize the recorder for this browser.", "failed");
  }

  return {
    stream,
    recorder,
    mimeType: recorder.mimeType || mimeType || "video/webm",
  };
}

export function stopScreenRecording(session: ScreenRecordingSession): Promise<Blob> {
  const { stream, recorder } = session;
  const chunks: Blob[] = [];

  return new Promise((resolve, reject) => {
    const mimeType = () => recorder.mimeType || session.mimeType || "video/webm";

    const finalizeTracks = () => {
      stream.getTracks().forEach((track) => track.stop());
    };

    const buildBlob = (): Blob => {
      const type = mimeType();
      return new Blob(chunks, { type });
    };

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    recorder.onerror = () => {
      finalizeTracks();
      reject(new ScreenRecorderError("Recording failed.", "failed"));
    };

    recorder.onstop = () => {
      finalizeTracks();
      if (chunks.length === 0) {
        reject(
          new ScreenRecorderError(
            "No recording data was captured. Record for at least 2–3 seconds before stopping.",
            "failed",
          ),
        );
        return;
      }
      resolve(buildBlob());
    };

    if (recorder.state === "inactive") {
      if (chunks.length === 0) {
        reject(new ScreenRecorderError("No recording data was captured.", "failed"));
      } else {
        resolve(buildBlob());
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
        finalizeTracks();
        reject(
          err instanceof Error
            ? new ScreenRecorderError(err.message, "failed")
            : new ScreenRecorderError("Could not stop recording.", "failed"),
        );
      }
    })();
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
