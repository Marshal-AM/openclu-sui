"use client";

import { create } from "zustand";

type DeviceInteractionState = {
  selectedDeviceId: string | null;
  chooseDevice: (deviceId: string) => void;
  clearDeviceSelection: () => void;
};

export const useDeviceInteractionStore = create<DeviceInteractionState>((set) => ({
  selectedDeviceId: null,
  chooseDevice: (deviceId) => set({ selectedDeviceId: deviceId }),
  clearDeviceSelection: () => set({ selectedDeviceId: null }),
}));
