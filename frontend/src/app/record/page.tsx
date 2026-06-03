"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleIcon, SquareIcon } from "lucide-react";
import { toast } from "sonner";
import { makeSkillSlug, randomSlugSuffix } from "@/lib/skill-slug";
import {
  downloadRecordingBase64,
  uploadRecordingForSkill,
  type ProcessRecordingResponse,
} from "@/lib/process-recording-client";
import { PublishSkillPanel } from "@/components/skills/publish-skill-panel";
import type { FrameAnnotation, Transcript } from "@/lib/skill-md";
import { captureLivePreviewFrame, type ClientCapturedFrame } from "@/lib/extract-frames-client";
import { FRAME_INTERVAL_SEC } from "@/lib/recording-constants";
import {
  attachStreamEndedHandler,
  describeAudioCapture,
  getScreenCaptureDiagnostics,
  ScreenRecorderError,
  startScreenRecording,
  stopScreenRecording,
  type RecordingAudioCapture,
  type ScreenRecorderStatus,
  type ScreenRecordingSession,
} from "@/lib/screen-recorder";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type MetadataForm = {
  skillSlug: string;
  title: string;
  description: string;
  triggers: string;
  extraTags: string;
  expertiseSource: string;
  recordedAt: string;
};

function defaultSaleEndLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 16);
}

function Stage({
  step,
  title,
  description,
  children,
}: {
  step: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="mb-5 flex items-start gap-3">
        <div className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-medium text-primary">
          {step}
        </div>
        <div>
          <h2 className="text-base font-medium leading-none">{title}</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function emptyForm(): MetadataForm {
  return {
    skillSlug: "",
    title: "",
    description: "",
    triggers: "",
    extraTags: "",
    expertiseSource: "",
    recordedAt: new Date().toISOString().slice(0, 16),
  };
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function RecordPage() {
  const router = useRouter();
  const [form, setForm] = useState<MetadataForm>(emptyForm);
  const [slugSuffix, setSlugSuffix] = useState(() => randomSlugSuffix());
  const [quitHref, setQuitHref] = useState<string | null>(null);
  const [saleEndLocal, setSaleEndLocal] = useState(defaultSaleEndLocal);
  const [recorderStatus, setRecorderStatus] = useState<ScreenRecorderStatus>("idle");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [captureWarning, setCaptureWarning] = useState<string | null>(null);
  const [processingStep, setProcessingStep] = useState<string | null>(null);
  const [skillMd, setSkillMd] = useState<string | null>(null);
  const [processResult, setProcessResult] = useState<ProcessRecordingResponse | null>(null);
  const [processError, setProcessError] = useState<string | null>(null);
  const [audioCaptureInfo, setAudioCaptureInfo] = useState<RecordingAudioCapture | null>(null);

  const sessionRef = useRef<ScreenRecordingSession | null>(null);
  const formRef = useRef(form);
  const slugSuffixRef = useRef(slugSuffix);
  formRef.current = form;
  slugSuffixRef.current = slugSuffix;
  const finalizingRef = useRef(false);
  const detachStreamEndRef = useRef<(() => void) | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const frameCaptureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const capturedFramesRef = useRef<ClientCapturedFrame[]>([]);
  const frameIndexRef = useRef(0);
  const allowNavigationRef = useRef(false);
  const previewRef = useRef<HTMLVideoElement | null>(null);

  const isRecording = recorderStatus === "recording";
  const isProcessing = recorderStatus === "processing";
  const isBusy =
    recorderStatus === "requesting" ||
    recorderStatus === "stopping" ||
    isProcessing;
  const hasProgress = isRecording;

  const clearElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  const clearFrameCaptureTimer = useCallback(() => {
    if (frameCaptureTimerRef.current) {
      clearInterval(frameCaptureTimerRef.current);
      frameCaptureTimerRef.current = null;
    }
  }, []);

  const cleanupSession = useCallback(() => {
    detachStreamEndRef.current?.();
    detachStreamEndRef.current = null;
    const session = sessionRef.current;
    if (session) {
      session.stream.getTracks().forEach((t) => t.stop());
      if (session.recorder.state !== "inactive") {
        try {
          session.recorder.stop();
        } catch {
          /* ignore */
        }
      }
    }
    sessionRef.current = null;
    if (previewRef.current) {
      previewRef.current.srcObject = null;
    }
    clearElapsedTimer();
    clearFrameCaptureTimer();
    capturedFramesRef.current = [];
    frameIndexRef.current = 0;
    setElapsedSec(0);
    setAudioCaptureInfo(null);
  }, [clearElapsedTimer, clearFrameCaptureTimer]);

  const finalizeRecording = useCallback(
    async (reason: "user" | "share-ended") => {
      if (finalizingRef.current) return;
      const session = sessionRef.current;
      if (!session) {
        cleanupSession();
        setRecorderStatus("idle");
        return;
      }

      finalizingRef.current = true;
      setRecorderStatus("stopping");
      clearElapsedTimer();

      try {
        clearFrameCaptureTimer();
        const finalFrame = await captureLivePreviewFrame(
          previewRef.current,
          elapsedSec,
          frameIndexRef.current,
        );
        if (finalFrame) {
          capturedFramesRef.current.push(finalFrame);
          frameIndexRef.current += 1;
        }
        const liveFrames = [...capturedFramesRef.current];

        const { video: blob, narration } = await stopScreenRecording(session);
        if (session.audioCapture.narrationSidecar && !narration) {
          toast.warning("Voice track was invalid", {
            description:
              "The browser did not produce a valid audio file. Record at least 15 seconds in Edge on http://localhost:3000/record.",
          });
        }
        const current = formRef.current;
        const suffix = slugSuffixRef.current;
        const title = current.title.trim();
        const description = current.description.trim();
        const slug =
          current.skillSlug.trim() ||
          makeSkillSlug(title, suffix) ||
          "screen-recording";

        if (!title || !description) {
          throw new Error("Title and description are required before processing.");
        }

        setRecorderStatus("processing");
        setProcessingStep("Capturing frames and uploading for AI analysis…");
        setProcessError(null);
        setSkillMd(null);
        setProcessResult(null);

        const result = await uploadRecordingForSkill(
          blob,
          {
            skillSlug: slug,
            title,
            description,
            triggers: current.triggers,
            extraTags: current.extraTags,
            expertiseSource: current.expertiseSource,
            recordedAt: new Date().toISOString(),
          },
          {
            frames: liveFrames,
            clientHadAudioTracks: session.audioCapture.source !== "none",
            narrationAudio: narration,
          },
        );

        setProcessingStep("Saving recording and skill bundle…");
        if (result.recording?.base64) {
          downloadRecordingBase64(result.recording.base64, result.recording.mimeType, slug);
        } else if (result.recording?.tooLarge) {
          toast.info("Recording download skipped", {
            description: `Recording is ${(result.recording.byteLength / (1024 * 1024)).toFixed(1)} MB — SKILL.md was still generated.`,
          });
        }
        setSkillMd(result.skillMd);
        setProcessResult(result);

        if (result.audioWarning) {
          toast.warning("Audio note", { description: result.audioWarning });
        }
        if (result.videoWarning) {
          toast.warning("Video note", { description: result.videoWarning });
        }

        toast.success("Skill extracted", {
          description:
            reason === "share-ended"
              ? "Screen share ended — SKILL.md generated via Groq."
              : "SKILL.md generated from your recording.",
        });
      } catch (err) {
        const message =
          err instanceof ScreenRecorderError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Could not process recording.";
        setProcessError(message);
        if (reason !== "share-ended" || !(err instanceof ScreenRecorderError && err.code === "failed")) {
          toast.error("Processing failed", { description: message });
        }
      } finally {
        finalizingRef.current = false;
        sessionRef.current = null;
        detachStreamEndRef.current = null;
        if (previewRef.current) previewRef.current.srcObject = null;
        setRecorderStatus("idle");
        setProcessingStep(null);
        setElapsedSec(0);
      }
    },
    [cleanupSession, clearElapsedTimer, clearFrameCaptureTimer, elapsedSec],
  );

  const stopRecording = useCallback(() => {
    void finalizeRecording("user");
  }, [finalizeRecording]);

  function updateTitle(title: string) {
    const suffix = slugSuffix || randomSlugSuffix();
    if (!slugSuffix) setSlugSuffix(suffix);
    setForm((current) => ({
      ...current,
      title,
      skillSlug: makeSkillSlug(title, suffix),
    }));
  }

  function confirmQuitProgress() {
    if (!quitHref) return;
    allowNavigationRef.current = true;
    cleanupSession();
    router.push(quitHref);
  }

  async function startRecording() {
    if (!form.title.trim() || !form.description.trim()) {
      toast.error("Title and description are required.");
      return;
    }

    const diagnostics = getScreenCaptureDiagnostics();
    if (!diagnostics.supported) {
      toast.error("Cannot start screen recording", {
        description: diagnostics.reason ?? "Use http://localhost:3000 in Edge.",
      });
      return;
    }

    setRecorderStatus("requesting");

    const slug = form.skillSlug || makeSkillSlug(form.title, slugSuffix);
    if (slug && !form.skillSlug) {
      setForm((current) => ({ ...current, skillSlug: slug }));
    }

    try {
      const session = await startScreenRecording();
      sessionRef.current = session;
      setAudioCaptureInfo(session.audioCapture);

      if (previewRef.current) {
        previewRef.current.srcObject = session.stream;
        void previewRef.current.play().catch(() => undefined);
      }

      capturedFramesRef.current = [];
      frameIndexRef.current = 0;

      setRecorderStatus("recording");
      setElapsedSec(0);

      void captureLivePreviewFrame(previewRef.current, 0, 0).then((frame) => {
        if (frame) {
          capturedFramesRef.current.push(frame);
          frameIndexRef.current = 1;
        }
      });

      elapsedTimerRef.current = setInterval(() => {
        setElapsedSec((n) => n + 1);
      }, 1000);

      frameCaptureTimerRef.current = setInterval(() => {
        const t = frameIndexRef.current * FRAME_INTERVAL_SEC;
        void captureLivePreviewFrame(previewRef.current, t, frameIndexRef.current).then((frame) => {
          if (frame) {
            capturedFramesRef.current.push(frame);
            frameIndexRef.current += 1;
          }
        });
      }, FRAME_INTERVAL_SEC * 1000);

      detachStreamEndRef.current = attachStreamEndedHandler(session.stream, () => {
        toast.info("Screen share ended");
        void finalizeRecording("share-ended");
      });

      toast.success("Recording started", {
        description: `Audio: ${describeAudioCapture(session.audioCapture)}. Speak your review comments clearly.`,
      });
    } catch (err) {
      cleanupSession();
      setRecorderStatus("idle");
      const message =
        err instanceof ScreenRecorderError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not start screen recording.";
      if (!(err instanceof ScreenRecorderError && err.code === "aborted")) {
        toast.error("Could not start recording", { description: message });
      }
    }
  }

  useEffect(() => {
    const diagnostics = getScreenCaptureDiagnostics();
    setCaptureWarning(diagnostics.supported ? null : diagnostics.reason);
  }, []);

  useEffect(() => {
    window.localStorage.removeItem("openclu:record-draft");
  }, []);

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      if (!hasProgress || allowNavigationRef.current || isRecording) return;
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      const nextUrl = new URL(href, window.location.href);
      if (nextUrl.origin !== window.location.origin || nextUrl.pathname === "/record") return;
      event.preventDefault();
      event.stopPropagation();
      setQuitHref(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasProgress) return;
      event.preventDefault();
    }

    document.addEventListener("click", handleDocumentClick, true);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      document.removeEventListener("click", handleDocumentClick, true);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasProgress, isRecording]);

  useEffect(() => {
    return () => {
      cleanupSession();
    };
  }, [cleanupSession]);

  const briefValid = Boolean(form.title.trim() && form.description.trim());

  return (
    <div className="flex w-full flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Contribute Data</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fill in the skill brief, then record your screen directly from the browser.
        </p>
      </div>

      {captureWarning ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p>{captureWarning}</p>
          <p className="mt-2 text-xs text-destructive/90">
            Current URL:{" "}
            <span className="font-mono">
              {typeof window !== "undefined" ? window.location.href : ""}
            </span>
          </p>
        </div>
      ) : null}

      {isRecording ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <CircleIcon className="size-3 fill-destructive text-destructive animate-pulse" />
              Recording — {formatElapsed(elapsedSec)}
            </div>
            {audioCaptureInfo ? (
              <p className="text-xs text-muted-foreground">
                Audio: {describeAudioCapture(audioCaptureInfo)}
                {audioCaptureInfo.source === "microphone"
                  ? " — narrate your comments while you work."
                  : ""}
              </p>
            ) : null}
          </div>
          <Button type="button" variant="destructive" size="sm" onClick={stopRecording}>
            <SquareIcon className="size-3.5 fill-current" />
            Stop recording
          </Button>
        </div>
      ) : null}

      {isProcessing && processingStep ? (
        <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Processing with Groq…</p>
          <p className="mt-1">{processingStep}</p>
          <p className="mt-2 text-xs">
            Transcribing audio (Whisper), annotating screen frames (vision), then extracting SKILL.md.
          </p>
        </div>
      ) : null}

      {processError ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {processError}
          {processError.includes("GROQ_API_KEY") ? (
            <span className="mt-2 block text-xs">
              Copy <code className="text-xs">frontend/.env.local.example</code> to{" "}
              <code className="text-xs">.env.local</code> and set your Groq API key, then restart{" "}
              <code className="text-xs">npm run dev</code>.
            </span>
          ) : null}
        </p>
      ) : null}

      {skillMd && processResult ? (
        <>
          <section className="rounded-xl border bg-card p-5 shadow-sm">
            <h2 className="text-base font-medium">Extraction sources</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              The skill is built from your audio transcript plus on-screen text captured every{" "}
              {FRAME_INTERVAL_SEC}s. If audio is empty, only frames and your brief were used.
            </p>
            {processResult.audioWarning ? (
              <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
                {processResult.audioWarning}
              </p>
            ) : (
              <p className="mt-3 text-sm text-green-700 dark:text-green-400">
                Audio transcribed ({processResult.transcript.segments.length} segment
                {processResult.transcript.segments.length === 1 ? "" : "s"}).
              </p>
            )}
            {processResult.transcript.full_text?.trim() ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium">View transcript</summary>
                <pre className="mt-2 max-h-48 overflow-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap">
                  {processResult.transcript.full_text}
                </pre>
              </details>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                No transcript text — speak your review comments while recording, or enable system
                audio when sharing the screen.
              </p>
            )}
            {processResult.frameAnnotations.length > 0 ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium">
                  View screen capture notes ({processResult.frameAnnotations.length} frames)
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap">
                  {processResult.frameAnnotations
                    .map((a) => {
                      const lines = [
                        `[${(a.timestamp ?? 0).toFixed(1)}s] ${a.app} — ${a.action}`,
                        a.details,
                      ];
                      if (a.visible_text?.trim()) lines.push(`Text: ${a.visible_text}`);
                      if (a.file_references?.trim()) lines.push(`Refs: ${a.file_references}`);
                      return lines.join("\n");
                    })
                    .join("\n\n")}
                </pre>
              </details>
            ) : null}
          </section>
          <section className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-medium">Generated SKILL.md</h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(skillMd);
                  toast.success("Copied SKILL.md to clipboard");
                }}
              >
                Copy
              </Button>
            </div>
            <pre className="max-h-[28rem] overflow-auto rounded-lg border bg-muted/50 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
              {skillMd}
            </pre>
          </section>
          <PublishSkillPanel
            skillSlug={form.skillSlug}
            title={form.title}
            description={form.description}
            skillMd={skillMd}
            transcript={processResult.transcript as Transcript}
            frameAnnotations={processResult.frameAnnotations as FrameAnnotation[]}
            recordedAt={form.recordedAt || new Date().toISOString()}
            expertiseSource={form.expertiseSource || "human_recording"}
            triggers={form.triggers.split(",").map((t) => t.trim()).filter(Boolean)}
            extraTags={form.extraTags.split(",").map((t) => t.trim()).filter(Boolean)}
          />
        </>
      ) : null}

      <video
        ref={previewRef}
        className="hidden"
        muted
        playsInline
        aria-hidden
      />

      <Stage
        step="1"
        title="Skill brief"
        description="Name the skill and define how agents should discover it."
      >
        <FieldGroup>
          <Field>
            <FieldLabel>Title</FieldLabel>
            <Input
              value={form.title}
              onChange={(e) => updateTitle(e.target.value)}
              placeholder="Example: Debug a failing Next.js build"
              disabled={isRecording || isProcessing}
            />
            {form.skillSlug ? (
              <FieldDescription>Generated slug: {form.skillSlug}</FieldDescription>
            ) : null}
          </Field>
          <Field>
            <FieldLabel>Description</FieldLabel>
            <Textarea
              rows={4}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What does this skill help another agent do?"
              disabled={isRecording || isProcessing}
            />
          </Field>
          <Field>
            <FieldLabel>Triggers</FieldLabel>
            <Textarea
              className="font-mono text-xs"
              rows={4}
              value={form.triggers}
              onChange={(e) => setForm({ ...form, triggers: e.target.value })}
              disabled={isRecording || isProcessing}
            />
            <FieldDescription>One trigger per line.</FieldDescription>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>Extra tags</FieldLabel>
              <Input
                value={form.extraTags}
                onChange={(e) => setForm({ ...form, extraTags: e.target.value })}
                disabled={isRecording || isProcessing}
              />
              <FieldDescription>Comma-separated tags.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Expertise source</FieldLabel>
              <Input
                value={form.expertiseSource}
                onChange={(e) => setForm({ ...form, expertiseSource: e.target.value })}
                disabled={isRecording || isProcessing}
              />
            </Field>
          </div>
        </FieldGroup>
        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          {isRecording ? (
            <Button type="button" variant="destructive" onClick={stopRecording}>
              <SquareIcon className="size-4 fill-current" />
              Stop recording
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => void startRecording()}
              disabled={!briefValid || isBusy}
            >
              {recorderStatus === "requesting" ? "Waiting for screen…" : "Start recording"}
            </Button>
          )}
        </div>
      </Stage>

      <Dialog open={!!quitHref} onOpenChange={(open) => !open && setQuitHref(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Stop recording and leave?</DialogTitle>
            <DialogDescription>
              A recording is in progress. Leaving will stop the capture.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setQuitHref(null)}>
              Stay here
            </Button>
            <Button type="button" variant="destructive" onClick={confirmQuitProgress}>
              Leave page
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
