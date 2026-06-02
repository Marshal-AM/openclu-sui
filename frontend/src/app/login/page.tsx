"use client";

import { ConnectButton } from "@mysten/dapp-kit";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAppWallet } from "@/components/auth/current-wallet";
import { OpenCluLogo } from "@/components/OpenCluLogo";

export default function LoginPage() {
  const router = useRouter();
  const { ready, connected, suiAddress } = useAppWallet();

  useEffect(() => {
    if (ready && connected && suiAddress) {
      router.replace("/record");
    }
  }, [connected, ready, router, suiAddress]);

  return (
    <main className="grid min-h-svh place-items-center bg-background p-6">
      <section className="flex w-full max-w-md flex-col items-center gap-8">
        <OpenCluLogo className="h-auto w-64 max-w-[80vw]" />
        <p className="w-full text-center text-sm text-muted-foreground">
          Connect the <strong>Sui</strong> account in your Phantom extension (not Ethereum or
          Solana). Use the button below and choose Phantom in the wallet list.
        </p>
        <div className="flex w-full flex-col items-center gap-3">
          {!ready ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : connected ? (
            <button
              type="button"
              className="rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground"
              onClick={() => router.push("/record")}
            >
              Continue to dashboard
            </button>
          ) : (
            <ConnectButton connectText="Connect Phantom (Sui)" />
          )}
        </div>
      </section>
    </main>
  );
}
