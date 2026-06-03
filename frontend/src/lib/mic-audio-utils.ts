/**
 * Microphone helpers for debugging Mac capture (levels, devices, constraints).
 */

export type MicCaptureProfile = "default" | "mac-friendly";

export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|Macintosh/i.test(navigator.platform || navigator.userAgent);
}

/** mac-friendly turns off aggressive DSP that can strip speech on MacBook mics. */
export function getMicAudioConstraints(
  profile: MicCaptureProfile = isApplePlatform() ? "mac-friendly" : "default",
  deviceId?: string,
): MediaTrackConstraints {
  const base: MediaTrackConstraints =
    profile === "mac-friendly"
      ? {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
        }
      : {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        };

  if (deviceId) {
    return { ...base, deviceId: { exact: deviceId } };
  }
  return base;
}

export type MicInputDevice = {
  deviceId: string;
  label: string;
};

export async function listMicInputDevices(): Promise<MicInputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "audioinput")
    .map((d) => ({
      deviceId: d.deviceId,
      label: d.label || `Microphone ${d.deviceId.slice(0, 8) || "default"}`,
    }));
}

export type MicLevelSnapshot = {
  /** Current instantaneous level 0–1 */
  current: number;
  /** Peak seen since monitor started 0–1 */
  peak: number;
  /** Rolling average level 0–1 */
  average: number;
  /** Fraction of samples below silence threshold */
  silentRatio: number;
};

export type MicLevelMonitor = {
  getSnapshot: () => MicLevelSnapshot;
  stop: () => void;
};

const SILENCE_THRESHOLD = 0.02;

export function attachMicLevelMonitor(stream: MediaStream): MicLevelMonitor {
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  const timeData = new Uint8Array(analyser.fftSize);
  let peak = 0;
  let sum = 0;
  let samples = 0;
  let silentSamples = 0;
  let current = 0;

  const tick = () => {
    analyser.getByteTimeDomainData(timeData);
    let framePeak = 0;
    for (let i = 0; i < timeData.length; i++) {
      const v = Math.abs(timeData[i]! - 128) / 128;
      if (v > framePeak) framePeak = v;
    }
    current = framePeak;
    peak = Math.max(peak, framePeak);
    sum += framePeak;
    samples += 1;
    if (framePeak < SILENCE_THRESHOLD) silentSamples += 1;
  };

  const intervalId = window.setInterval(tick, 80);

  return {
    getSnapshot: () => ({
      current,
      peak,
      average: samples > 0 ? sum / samples : 0,
      silentRatio: samples > 0 ? silentSamples / samples : 1,
    }),
    stop: () => {
      window.clearInterval(intervalId);
      source.disconnect();
      void ctx.close().catch(() => undefined);
    },
  };
}

export type BlobLevelAnalysis = {
  peak: number;
  rms: number;
  durationSec: number;
  likelySilent: boolean;
  decodeError?: string;
};

/** Decode recorded blob in-browser — confirms speech vs near-silence before Whisper. */
export async function analyzeBlobAudioLevels(blob: Blob): Promise<BlobLevelAnalysis> {
  if (blob.size < 256) {
    return {
      peak: 0,
      rms: 0,
      durationSec: 0,
      likelySilent: true,
      decodeError: "Blob too small",
    };
  }

  try {
    const ctx = new AudioContext();
    const buffer = await blob.arrayBuffer();
    const audio = await ctx.decodeAudioData(buffer.slice(0));
    const channel = audio.getChannelData(0);
    let peak = 0;
    let sumSq = 0;
    for (let i = 0; i < channel.length; i++) {
      const sample = channel[i] ?? 0;
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
      sumSq += sample * sample;
    }
    const rms = channel.length > 0 ? Math.sqrt(sumSq / channel.length) : 0;
    await ctx.close();

    const likelySilent = peak < 0.01 || rms < 0.005;
    return {
      peak,
      rms,
      durationSec: audio.duration,
      likelySilent,
    };
  } catch (err) {
    return {
      peak: 0,
      rms: 0,
      durationSec: 0,
      likelySilent: true,
      decodeError: err instanceof Error ? err.message : String(err),
    };
  }
}

export function interpretMicLevels(snapshot: MicLevelSnapshot): string {
  if (snapshot.peak < 0.02) {
    return "No input detected — check Mac System Settings → Sound → Input, pick the right mic, and speak louder.";
  }
  if (snapshot.peak < 0.08) {
    return "Very quiet input — move closer to the mic or raise input volume in System Settings.";
  }
  if (snapshot.silentRatio > 0.85) {
    return "Mostly silence — only brief spikes. Keep speaking steadily while recording.";
  }
  return "Mic level looks healthy — speech should transcribe.";
}
