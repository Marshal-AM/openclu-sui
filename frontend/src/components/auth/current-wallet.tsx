"use client";

import {
  useCurrentAccount,
  useCurrentWallet as useSuiWalletConnection,
  useDisconnectWallet,
} from "@mysten/dapp-kit";
import { createContext, useCallback, useContext, useMemo } from "react";

type CurrentWalletContextValue = {
  ready: boolean;
  connected: boolean;
  /** Address from your Phantom (or other) Sui wallet extension */
  suiAddress: string | null;
  signOut: () => Promise<void>;
};

const CurrentWalletContext = createContext<CurrentWalletContextValue | null>(null);

export function CurrentWalletProvider({ children }: { children: React.ReactNode }) {
  const account = useCurrentAccount();
  const { connectionStatus } = useSuiWalletConnection();
  const { mutateAsync: disconnect } = useDisconnectWallet();

  const suiAddress = account?.address ?? null;
  const ready = connectionStatus !== "connecting";
  const connected = !!suiAddress;

  const signOut = useCallback(async () => {
    if (connected) {
      await disconnect();
    }
  }, [connected, disconnect]);

  const value = useMemo<CurrentWalletContextValue>(
    () => ({
      ready,
      connected,
      suiAddress,
      signOut,
    }),
    [connected, ready, signOut, suiAddress],
  );

  return <CurrentWalletContext.Provider value={value}>{children}</CurrentWalletContext.Provider>;
}

export function useAppWallet() {
  const context = useContext(CurrentWalletContext);
  if (!context) {
    throw new Error("useAppWallet must be used within CurrentWalletProvider");
  }
  return context;
}
