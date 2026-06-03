"use client";

import { ConnectModal } from "@mysten/dapp-kit";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { useAppWallet } from "@/components/auth/current-wallet";
import { OpenCluLogo } from "@/components/OpenCluLogo";
import { Button } from "@/components/ui/button";
import { safeAuthRedirectPath } from "@/lib/auth-redirect";

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { ready, connected, suiAddress } = useAppWallet();
  const nextPath = safeAuthRedirectPath(searchParams.get("next"));

  useEffect(() => {
    if (ready && connected && suiAddress) {
      router.replace(nextPath);
    }
  }, [connected, nextPath, ready, router, suiAddress]);

  const canLogin = ready && !connected;

  return (
    <main className="grid min-h-svh place-items-center bg-background p-6">
      <section className="flex flex-col items-center gap-10">
        <OpenCluLogo priority className="h-auto w-72 max-w-[80vw]" />
        <ConnectModal
          trigger={
            <Button
              type="button"
              size="lg"
              className="h-12 rounded-full px-8"
              disabled={!canLogin}
            >
              {!ready || connected ? "Connecting..." : "Connect wallet"}
            </Button>
          }
        />
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-svh place-items-center bg-background p-6">
          <OpenCluLogo priority className="h-auto w-72 max-w-[80vw]" />
        </main>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
