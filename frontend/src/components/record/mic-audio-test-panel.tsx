"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MicIcon, PlayIcon, SquareIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  analyzeBlobAudioLevels,
  interpretMicLevels,
  isApplePlatform,
  listMicInputDevices,
  type MicCaptureProfile,
  type MicInputDevice,
  type MicLevelSnapshot,
} from "@/lib/mic-audio-utils";
import {
  getMicRecorderDiagnostics,
  ScreenRecorderError,
  startMicTestRecording,
  stopMicTestRecording,
  type MicRecorderDiagnostics,
  type MicTestSession,
  type RecordingBlobDiagnostics,
} from "@/lib/screen-recorder";
import {
  uploadAudioForTranscriptionTest,
  type TestAudioTranscriptionResponse,
  type TranscribeAttemptLog,
} from "@/lib/test-audio-transcription-client";

const MIN_TEST_SEC = 5;

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function levelPercent(level: number): number {
  return Math.min(100, Math.round(level * 100));
}

export function MicAudioTestPanel({ disabled }: { disabled?: boolean }) {
  const [micDiag, setMicDiag] = useState<MicRecorderDiagnostics | null>(null);
  const [devices, setDevices] = useState<MicInputDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [profile, setProfile] = useState<MicCaptureProfile>(
    isApplePlatform() ? "mac-friendly" : "default",
  );
  const [testing, setTesting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [liveLevel, setLiveLevel] = useState<MicLevelSnapshot | null>(null);
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [clientDiag, setClientDiag] = useState<RecordingBlobDiagnostics | null>(null);
  const [levelSnapshot, setLevelSnapshot] = useState<MicLevelSnapshot | null>(null);
  const [blobLevels, setBlobLevels] = useState<Awaited<ReturnType<typeof analyzeBlobAudioLevels>> | null>(
    null,
  );
  const [result, setResult] = useState<TestAudioTranscriptionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<MicTestSession | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const levelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshDevices = useCallback(async () => {
    const list = await listMicInputDevices();
    setDevices(list);
    if (list.length && !deviceId) {
      setDeviceId(list[0]!.deviceId);
    }
  }, [deviceId]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setMicDiag(getMicRecorderDiagnostics());
      void refreshDevices();
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (levelTimerRef.current) clearInterval(levelTimerRef.current);
      sessionRef.current?.micStream.getTracks().forEach((t) => t.stop());
      if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    };
  }, [refreshDevices, playbackUrl]);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (levelTimerRef.current) {
      clearInterval(levelTimerRef.current);
      levelTimerRef.current = null;
    }
  }, []);

  const stopMicCapture = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;

    clearTimers();
    setRecording(false);
    setError(null);
    setResult(null);

    try {
      const { blob, diagnostics, levelSnapshot: snap } = await stopMicTestRecording(session);
      sessionRef.current = null;
      setClientDiag(diagnostics);
      setLevelSnapshot(snap);
      setLiveLevel(snap);

      const levels = await analyzeBlobAudioLevels(blob);
      setBlobLevels(levels);

      if (playbackUrl) URL.revokeObjectURL(playbackUrl);
      const url = URL.createObjectURL(blob);
      setPlaybackUrl(url);
      setPendingBlob(blob);

      console.info("[mic-audio-test] captured", { snap, levels, diagnostics });

      if (elapsed < MIN_TEST_SEC) {
        toast.warning("Recording short", {
          description: `Speak for at least ${MIN_TEST_SEC} seconds. Got ${elapsed}s.`,
        });
      }

      if (snap.peak < 0.02 || levels.likelySilent) {
        toast.error("Mic captured silence or noise only", {
          description: interpretMicLevels(snap),
        });
      } else {
        toast.success("Recording ready", {
          description: "Play it back below. If it sounds clear, run transcription.",
        });
      }
    } catch (err) {
      const message =
        err instanceof ScreenRecorderError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Mic test failed.";
      setError(message);
      toast.error("Mic test failed", { description: message });
    } finally {
      setElapsed(0);
    }
  }, [clearTimers, elapsed, playbackUrl]);

  const runTranscription = useCallback(async () => {
    if (!pendingBlob) return;
    setTesting(true);
    setError(null);
    setResult(null);

    try {
      const response = await uploadAudioForTranscriptionTest(pendingBlob, {
        clientDiagnostics: clientDiag ?? undefined,
        levelSnapshot: levelSnapshot
          ? {
              peak: levelSnapshot.peak,
              average: levelSnapshot.average,
              silentRatio: levelSnapshot.silentRatio,
            }
          : undefined,
        blobLevels: blobLevels ?? undefined,
      });
      setResult(response);
      console.info("[mic-audio-test] server", response.server);

      if (response.server.loudness?.likelySilent) {
        toast.error("Server: audio file is very quiet", {
          description: `max ${response.server.loudness.maxVolumeDb ?? "?"} dB — Whisper may hallucinate.`,
        });
      } else if (!response.transcript.full_text?.trim()) {
        toast.warning("Empty transcript");
      } else if (
        response.transcript.full_text.trim().split(/\s+/).length <= 3 &&
        /^you\.?$/i.test(response.transcript.full_text.trim().toLowerCase())
      ) {
        toast.warning("Suspicious transcript", {
          description: "Likely noise-only input. Check playback and mic level.",
        });
      } else {
        toast.success("Transcription complete");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Transcription failed.";
      setError(message);
      toast.error("Transcription failed", { description: message });
    } finally {
      setTesting(false);
    }
  }, [pendingBlob, clientDiag, levelSnapshot, blobLevels]);

  const startMicCapture = useCallback(async () => {
    setError(null);
    setResult(null);
    setClientDiag(null);
    setLevelSnapshot(null);
    setBlobLevels(null);
    setPendingBlob(null);
    if (playbackUrl) {
      URL.revokeObjectURL(playbackUrl);
      setPlaybackUrl(null);
    }

    try {
      await refreshDevices();
      const session = await startMicTestRecording({
        deviceId: deviceId || undefined,
        profile,
      });
      sessionRef.current = session;
      setRecording(true);
      setElapsed(0);
      setLiveLevel(null);

      timerRef.current = setInterval(() => setElapsed((n) => n + 1), 1000);
      levelTimerRef.current = setInterval(() => {
        setLiveLevel(session.levelMonitor.getSnapshot());
      }, 80);

      toast.info("Mic test recording", {
        description: `Profile: ${profile}. Speak clearly for ${MIN_TEST_SEC}+ seconds.`,
      });
    } catch (err) {
      const message =
        err instanceof ScreenRecorderError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not access microphone.";
      setError(message);
      toast.error("Microphone error", { description: message });
    }
  }, [deviceId, profile, playbackUrl, refreshDevices]);

  const busy = disabled || testing;
  const levelHint = liveLevel ? interpretMicLevels(liveLevel) : null;

  return (
    <section className="rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">Test microphone & transcription</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Mac debug flow: watch the level meter while speaking → stop → <strong>play back</strong> the
            recording → transcribe. If playback is silent but the meter moved, the wrong input device is
            selected. Use <strong>mac-friendly</strong> profile (less noise suppression).
          </p>
          {isApplePlatform() ? (
            <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
              macOS: System Settings → Sound → Input — pick your mic and raise input volume. Prefer Chrome
              or Edge over Safari.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {recording ? (
            <Button type="button" variant="destructive" size="sm" onClick={() => void stopMicCapture()}>
              <SquareIcon className="size-3.5 fill-current" />
              Stop ({formatElapsed(elapsed)})
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void startMicCapture()}
            >
              <MicIcon className="size-3.5" />
              Record mic test
            </Button>
          )}
          {pendingBlob ? (
            <Button
              type="button"
              size="sm"
              disabled={busy || recording}
              onClick={() => void runTranscription()}
            >
              {testing ? "Transcribing…" : "Transcribe recording"}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs">
          <span className="font-medium text-muted-foreground">Input device</span>
          <select
            className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={deviceId}
            disabled={recording || busy}
            onChange={(e) => setDeviceId(e.target.value)}
          >
            {devices.length === 0 ? (
              <option value="">Default microphone</option>
            ) : (
              devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))
            )}
          </select>
        </label>
        <label className="text-xs">
          <span className="font-medium text-muted-foreground">Capture profile</span>
          <select
            className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={profile}
            disabled={recording || busy}
            onChange={(e) => setProfile(e.target.value as MicCaptureProfile)}
          >
            <option value="mac-friendly">mac-friendly (no noise suppression)</option>
            <option value="default">default (browser DSP)</option>
          </select>
        </label>
      </div>

      {recording || liveLevel ? (
        <div className="mt-4 rounded-md border bg-background/80 p-3">
          <p className="text-xs font-medium text-muted-foreground">Live mic level</p>
          <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-green-500 transition-all duration-75"
              style={{ width: `${levelPercent(liveLevel?.current ?? 0)}%` }}
            />
          </div>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            current={(liveLevel?.current ?? 0).toFixed(3)} peak={(liveLevel?.peak ?? 0).toFixed(3)}{" "}
            silent={(liveLevel ? (liveLevel.silentRatio * 100).toFixed(0) : "0")}%
          </p>
          {levelHint ? <p className="mt-1 text-xs">{levelHint}</p> : null}
        </div>
      ) : null}

      {playbackUrl ? (
        <div className="mt-4 rounded-md border bg-background/80 p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <PlayIcon className="size-4" />
            Playback (hear what Whisper will receive)
          </p>
          <audio className="mt-2 w-full" controls src={playbackUrl} />
          {blobLevels ? (
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              decoded peak={blobLevels.peak.toFixed(4)} rms={blobLevels.rms.toFixed(4)} duration=
              {blobLevels.durationSec.toFixed(1)}s
              {blobLevels.likelySilent ? " — LIKELY SILENT" : " — has signal"}
              {blobLevels.decodeError ? ` decode: ${blobLevels.decodeError}` : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {micDiag ? (
        <details className="mt-4 text-xs">
          <summary className="cursor-pointer font-medium text-muted-foreground">
            Browser audio diagnostics
          </summary>
          <pre className="mt-2 overflow-auto rounded-md border bg-background/80 p-3 font-mono">
            {JSON.stringify(micDiag, null, 2)}
          </pre>
        </details>
      ) : null}

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      {clientDiag ? (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer font-medium">Client recording blob</summary>
          <pre className="mt-2 overflow-auto rounded-md border bg-background/80 p-3 font-mono">
            {JSON.stringify({ clientDiag, levelSnapshot, blobLevels }, null, 2)}
          </pre>
        </details>
      ) : null}

      {result ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-md border bg-background/80 p-3">
            <p className="text-sm font-medium">Transcript</p>
            <p className="mt-2 text-sm whitespace-pre-wrap">
              {result.transcript.full_text?.trim() || "(empty)"}
            </p>
          </div>
          {result.server.loudness ? (
            <p className="text-xs text-muted-foreground">
              Server loudness: mean {result.server.loudness.meanVolumeDb ?? "?"} dB, max{" "}
              {result.server.loudness.maxVolumeDb ?? "?"} dB
              {result.server.loudness.likelySilent ? " — file too quiet for speech" : ""}
            </p>
          ) : null}
          <details className="text-xs">
            <summary className="cursor-pointer font-medium">Server attempts</summary>
            <AttemptTable attempts={result.server.attempts} />
          </details>
        </div>
      ) : null}
    </section>
  );
}

function AttemptTable({ attempts }: { attempts: TranscribeAttemptLog[] }) {
  return (
    <ul className="mt-2 space-y-1 font-mono text-xs">
      {attempts.map((a) => (
        <li
          key={a.label}
          className={a.ok ? "text-green-700 dark:text-green-400" : "text-destructive"}
        >
          {a.label}: {a.ok ? `ok — ${a.transcriptPreview ?? ""}` : `fail — ${a.error ?? ""}`}
        </li>
      ))}
    </ul>
  );
}
