"use client";

import { OpenCluLogo } from "@/components/OpenCluLogo";
import type { OwnedDevice } from "@/lib/device-types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type DeviceOptionCardProps = {
  device: OwnedDevice;
  size?: "sm" | "lg";
  mode?: "select" | "static";
  isCurrent?: boolean;
  isChosen?: boolean;
  onChoose?: () => void;
  onSelect?: () => Promise<void> | void;
};

function shortWallet(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function DeviceLogo({
  boxClassName,
  logoClassName,
}: {
  boxClassName?: string;
  logoClassName?: string;
}) {
  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-xl bg-muted/60 p-1.5",
        boxClassName,
      )}
    >
      <OpenCluLogo markOnly className={cn("object-contain", logoClassName ?? "size-7")} />
    </div>
  );
}

export function DeviceOptionCard({
  device,
  size = "sm",
  mode = "select",
  isCurrent = false,
  isChosen = false,
  onChoose,
  onSelect,
}: DeviceOptionCardProps) {
  const missingPortal = !device.orchestrator_url;
  const isLarge = size === "lg";
  const isStacked = isLarge && mode === "static";
  const interactive = Boolean(onChoose);
  const registeredLabel = formatDate(device.registered_at ?? device.created_at);

  const cardClassName = cn(
    "flex w-full flex-col overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border/80 transition-all",
    isStacked ? "min-h-52 justify-center px-6 py-6 text-center" : "gap-2 p-3",
    interactive && "cursor-pointer",
    isChosen ? "bg-primary/15 ring-primary/40 shadow-md" : interactive && "hover:bg-muted/35",
  );

  const selectButton =
    mode === "select" && isChosen ? (
      <Button
        type="button"
        variant="default"
        size="sm"
        className="h-9 w-full bg-primary text-primary-foreground hover:bg-primary/90"
        disabled={missingPortal || isCurrent}
        onClick={(event) => {
          event.stopPropagation();
          void onSelect?.();
        }}
      >
        {isCurrent ? "Selected" : "Select"}
      </Button>
    ) : null;

  if (isStacked) {
    return (
      <Card
        size="sm"
        tabIndex={interactive ? 0 : undefined}
        className={cardClassName}
        onClick={onChoose}
        onKeyDown={
          interactive
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onChoose?.();
                }
              }
            : undefined
        }
      >
        <div className="flex flex-col items-center gap-3">
          <DeviceLogo boxClassName="size-16" logoClassName="size-11" />
          <h3 className="w-full truncate text-lg font-semibold leading-snug">{device.device_name}</h3>
          <div className="flex w-full flex-col items-center gap-1.5 text-sm leading-snug text-muted-foreground">
            <p className="truncate">Device wallet {shortWallet(device.wallet_address)}</p>
            {registeredLabel ? <p>Registered {registeredLabel}</p> : null}
          </div>
          {missingPortal ? (
            <Badge variant="destructive" className="mt-0.5">
              Missing portal
            </Badge>
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <Card
      size="sm"
      tabIndex={interactive ? 0 : undefined}
      className={cardClassName}
      onClick={onChoose}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onChoose?.();
              }
            }
          : undefined
      }
    >
      <div className="flex min-w-0 items-center gap-3 text-left">
        <DeviceLogo boxClassName="size-10" logoClassName="size-7" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="truncate text-sm font-semibold leading-snug">{device.device_name}</p>
          <p className="truncate text-[11px] leading-snug text-muted-foreground">
            Device wallet {shortWallet(device.wallet_address)}
          </p>
          {(isCurrent || missingPortal) && (
            <div className="flex flex-wrap gap-1">
              {isCurrent ? <Badge variant="secondary">Current</Badge> : null}
              {missingPortal ? <Badge variant="destructive">Missing portal</Badge> : null}
            </div>
          )}
        </div>
      </div>

      {selectButton}
    </Card>
  );
}
