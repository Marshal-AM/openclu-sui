"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MicIcon, SquareIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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

export function MicAudioTestPanel({ disabled }: { disabled?: boolean }) {
  const [micDiag, setMicDiag] = useState<MicRecorderDiagnostics | null>(null);
  const [testing, setTesting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [clientDiag, setClientDiag] = useState<RecordingBlobDiagnostics | null>(null);
  const [result, setResult] = useState<TestAudioTranscriptionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<MicTestSession | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setMicDiag(getMicRecorderDiagnostics());
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      sessionRef.current?.micStream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopMicCapture = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;

    clearTimer();
    setRecording(false);
    setTesting(true);
    setError(null);
    setResult(null);

    try {
      const { blob, diagnostics } = await stopMicTestRecording(session);
      sessionRef.current = null;
      setClientDiag(diagnostics);

      if (elapsed < MIN_TEST_SEC) {
        toast.warning("Recording short", {
          description: `Speak for at least ${MIN_TEST_SEC} seconds. Got ${elapsed}s.`,
        });
      }

      const response = await uploadAudioForTranscriptionTest(blob, diagnostics);
      setResult(response);
      console.info("[mic-audio-test] server result", response.server);

      if (!response.transcript.full_text?.trim()) {
        toast.warning("Empty transcript", {
          description: "Check diagnostics below — Mac may need a different browser or mic permissions.",
        });
      } else {
        toast.success("Transcription complete");
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
      setTesting(false);
      setElapsed(0);
    }
  }, [clearTimer, elapsed]);

  const startMicCapture = useCallback(async () => {
    setError(null);
    setResult(null);
    setClientDiag(null);

    try {
      const session = await startMicTestRecording();
      sessionRef.current = session;
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((n) => n + 1), 1000);
      toast.info("Mic test recording", {
        description: `Speak clearly for ${MIN_TEST_SEC}+ seconds, then stop.`,
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
  }, []);

  const busy = disabled || testing;

  return (
    <section className="rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">Test microphone & transcription</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Records voice only (same pipeline as skill narration). Use this on Mac if you see
            nonsense transcripts like &quot;You You&quot;. Logs appear in the browser console and
            dev server terminal.
          </p>
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
              {testing ? "Transcribing…" : "Record mic test"}
            </Button>
          )}
        </div>
      </div>

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

      {error ? (
        <p className="mt-3 text-sm text-destructive">{error}</p>
      ) : null}

      {clientDiag ? (
        <details className="mt-3 text-xs" open>
          <summary className="cursor-pointer font-medium">Client recording blob</summary>
          <pre className="mt-2 overflow-auto rounded-md border bg-background/80 p-3 font-mono">
            {JSON.stringify(clientDiag, null, 2)}
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
            {result.transcript.segments.length > 0 ? (
              <pre className="mt-2 max-h-40 overflow-auto font-mono text-xs text-muted-foreground">
                {result.transcript.segments
                  .map((s) => `[${s.t_start}s] ${s.text}`)
                  .join("\n")}
              </pre>
            ) : null}
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer font-medium">Server transcription attempts</summary>
            <AttemptTable attempts={result.server.attempts} />
            <pre className="mt-2 overflow-auto rounded-md border bg-background/80 p-3 font-mono">
              {JSON.stringify(result.server, null, 2)}
            </pre>
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
        <li key={a.label} className={a.ok ? "text-green-700 dark:text-green-400" : "text-destructive"}>
          {a.label}: {a.ok ? `ok — ${a.transcriptPreview ?? ""}` : `fail — ${a.error ?? ""}`}
        </li>
      ))}
    </ul>
  );
}
