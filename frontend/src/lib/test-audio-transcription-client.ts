import type { Transcript } from "@/lib/skill-md";
import type { RecordingBlobDiagnostics } from "@/lib/screen-recorder";

export type TranscribeAttemptLog = {
  label: string;
  ok: boolean;
  error?: string;
  transcriptPreview?: string;
};

export type TestAudioTranscriptionResponse = {
  ok: true;
  transcript: Transcript;
  clientDiagnostics?: RecordingBlobDiagnostics;
  server: {
    sniff: string;
    magicHex: string;
    byteSize: number;
    attempts: TranscribeAttemptLog[];
  };
};

export async function uploadAudioForTranscriptionTest(
  audio: Blob,
  clientDiagnostics?: RecordingBlobDiagnostics,
): Promise<TestAudioTranscriptionResponse> {
  if (audio.size < 256) {
    throw new Error("Recording too short. Speak for at least 5 seconds.");
  }

  const form = new FormData();
  const ext = audio.type.includes("mp4") ? "m4a" : "webm";
  form.append("audio", audio, `mic-test.${ext}`);
  if (clientDiagnostics) {
    form.append("client_diagnostics", JSON.stringify(clientDiagnostics));
  }

  const res = await fetch("/api/skills/test-audio-transcription", {
    method: "POST",
    body: form,
  });

  const data = (await res.json().catch(() => ({}))) as TestAudioTranscriptionResponse & {
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? `Test failed (${res.status})`);
  }

  return data;
}
