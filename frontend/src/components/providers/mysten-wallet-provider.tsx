"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { CurrentWalletProvider } from "@/components/auth/current-wallet";
import { SuiWalletProvider } from "@/components/providers/sui-wallet-provider";

/** App shell: React Query + Mysten dapp-kit (Phantom / other Sui wallets). */
export function MystenWalletProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={client}>
      <SuiWalletProvider>
        <CurrentWalletProvider>{children}</CurrentWalletProvider>
      </SuiWalletProvider>
    </QueryClientProvider>
  );
}
