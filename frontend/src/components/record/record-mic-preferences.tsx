"use client";

import { useEffect, useState } from "react";
import {
  isApplePlatform,
  listMicInputDevices,
  type MicCaptureProfile,
  type MicInputDevice,
} from "@/lib/mic-audio-utils";

export type RecordMicPreferences = {
  deviceId: string;
  profile: MicCaptureProfile;
};

export function defaultRecordMicPreferences(): RecordMicPreferences {
  return {
    deviceId: "",
    profile: isApplePlatform() ? "mac-friendly" : "default",
  };
}

export function RecordMicPreferencesFields({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: RecordMicPreferences;
  onChange: (next: RecordMicPreferences) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [devices, setDevices] = useState<MicInputDevice[]>([]);

  useEffect(() => {
    void listMicInputDevices().then(setDevices);
  }, []);

  return (
    <div className={compact ? "grid gap-3 sm:grid-cols-2" : "mt-4 grid gap-3 sm:grid-cols-2"}>
      <label className="text-xs">
        <span className="font-medium text-muted-foreground">Microphone</span>
        <select
          className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          value={value.deviceId}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, deviceId: e.target.value })}
        >
          <option value="">System default</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs">
        <span className="font-medium text-muted-foreground">Voice capture profile</span>
        <select
          className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          value={value.profile}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, profile: e.target.value as MicCaptureProfile })}
        >
          <option value="mac-friendly">mac-friendly (recommended on Mac)</option>
          <option value="default">default (browser noise suppression)</option>
        </select>
      </label>
      {isApplePlatform() && !compact ? (
        <p className="sm:col-span-2 text-xs text-muted-foreground">
          Recordings use a dedicated voice track with mac-friendly DSP and MP4/WebM suited for
          Whisper on macOS.
        </p>
      ) : null}
    </div>
  );
}
