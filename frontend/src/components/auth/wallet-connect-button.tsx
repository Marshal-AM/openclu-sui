"use client";

import { ConnectButton } from "@mysten/dapp-kit";
import { LogOutIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppWallet } from "@/components/auth/current-wallet";
import { WalletAddressChip } from "@/components/WalletAddressChip";

export function WalletConnectButton() {
  const { ready, connected, suiAddress, signOut } = useAppWallet();

  if (!ready) {
    return (
      <Button type="button" variant="outline" size="sm" disabled>
        Loading…
      </Button>
    );
  }

  if (!connected) {
    return <ConnectButton connectText="Connect Phantom (Sui)" />;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <WalletAddressChip label="Sui" address={suiAddress} />
      <Button type="button" variant="ghost" size="icon-sm" onClick={() => void signOut()}>
        <LogOutIcon className="size-4" />
        <span className="sr-only">Disconnect wallet</span>
      </Button>
    </div>
  );
}
