"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAppWallet } from "@/components/auth/current-wallet";
import { buildLoginRedirectPath } from "@/lib/auth-redirect";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { ready, connected, suiAddress } = useAppWallet();

  useEffect(() => {
    if (!ready) return;
    if (pathname === "/login") return;
    if (!connected || !suiAddress) {
      router.replace(buildLoginRedirectPath(pathname));
    }
  }, [connected, pathname, ready, router, suiAddress]);

  if (!ready) {
    return (
      <div className="grid min-h-[40vh] place-items-center text-sm text-muted-foreground">
        Loading wallet…
      </div>
    );
  }

  if (pathname !== "/login" && (!connected || !suiAddress)) {
    return null;
  }

  return children;
}
