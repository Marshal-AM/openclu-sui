"use client";

import { shortAddress } from "@/lib/address";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export function WalletAddressChip({
  label,
  address,
  className,
}: {
  label?: string;
  address: string | null | undefined;
  className?: string;
}) {
  if (!address) return null;

  return (
    <Badge variant="secondary" className={cn("font-mono text-xs", className)}>
      {label ? `${label} ` : null}
      {shortAddress(address)}
    </Badge>
  );
}
