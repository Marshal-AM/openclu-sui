import { NextResponse } from "next/server";
import { transcribeNarrationFile } from "@/lib/groq-skill-processor";
import {
  cleanupWorkDir,
  createWorkDir,
  sniffMediaContainerFromPath,
  sniffVideoContainer,
  writeUploadBuffer,
} from "@/lib/video-ffmpeg";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

export async function POST(request: Request) {
  let workDir: string | null = null;

  try {
    const form = await request.formData();
    const audio = form.get("audio");

    if (!audio || !(audio instanceof Blob)) {
      return NextResponse.json({ error: "Missing audio upload." }, { status: 400 });
    }

    if (audio.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: "Audio file too large." }, { status: 413 });
    }

    let clientDiagnostics: unknown = null;
    const clientRaw = form.get("client_diagnostics");
    if (typeof clientRaw === "string") {
      try {
        clientDiagnostics = JSON.parse(clientRaw);
      } catch {
        clientDiagnostics = null;
      }
    }

    workDir = await createWorkDir("openclu-audio-test");
    const buffer = Buffer.from(await audio.arrayBuffer());
    const sniffed = sniffVideoContainer(buffer);
    const ext =
      sniffed === "mp4" ? "m4a" : sniffed === "webm" ? "webm" : audio.type.includes("mp4") ? "m4a" : "webm";
    const audioPath = await writeUploadBuffer(workDir, `mic-test.${ext}`, buffer);
    const sniffOnDisk = await sniffMediaContainerFromPath(audioPath);

    console.log(
      `[test-audio-transcription] ${(audio.size / 1024).toFixed(1)} KB ` +
        `type=${audio.type} sniff=${sniffOnDisk} client=`,
      clientDiagnostics,
    );

    const result = await transcribeNarrationFile(audioPath, workDir);

    return NextResponse.json({
      ok: true,
      transcript: result.transcript,
      clientDiagnostics,
      server: {
        sniff: result.sniff,
        magicHex: result.magicHex,
        byteSize: result.byteSize,
        attempts: result.attempts,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Audio test failed.";
    console.error("[test-audio-transcription]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (workDir) await cleanupWorkDir(workDir);
  }
}
