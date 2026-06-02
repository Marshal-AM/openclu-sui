"use client";

import { DeviceOptionCard } from "@/components/DeviceOptionCard";
import type { OwnedDevice } from "@/lib/device-types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

type DeviceChooserDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  devices: OwnedDevice[];
  selectedDeviceId: string | null;
  deviceChoiceId: string | null;
  onChoiceChange: (deviceId: string | null) => void;
  onSelect: (deviceId: string) => Promise<void> | void;
};

export function DeviceChooserDialog({
  open,
  onOpenChange,
  devices,
  selectedDeviceId,
  deviceChoiceId,
  onChoiceChange,
  onSelect,
}: DeviceChooserDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[min(94vw,1200px)] overflow-hidden p-0 sm:max-w-[94vw] lg:max-w-[1200px]">
        <div className="flex h-full min-h-0 flex-col">
          <DialogHeader className="shrink-0 px-6 pt-6">
            <DialogTitle>Choose device for portal actions</DialogTitle>
            <DialogDescription>
              Pick a device only when you are about to run portal jobs.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 px-6 pb-6 pt-2">
            {devices.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No devices available</EmptyTitle>
                  <EmptyDescription>
                    Register a device first, then return to contribution flow.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,260px))] items-start justify-start gap-3 overflow-y-auto p-1">
                {devices.map((device) => {
                  const isSelected = device.id === selectedDeviceId;
                  const isChoice = device.id === deviceChoiceId;

                  return (
                    <DeviceOptionCard
                      key={device.id}
                      device={device}
                      isCurrent={isSelected}
                      isChosen={isChoice}
                      onChoose={() => onChoiceChange(device.id)}
                      onSelect={() => onSelect(device.id)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
