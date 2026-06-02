"use client";

import { createNetworkConfig, SuiClientProvider, WalletProvider } from "@mysten/dapp-kit";
import { getFullnodeUrl } from "@mysten/sui/client";
import { type ReactNode } from "react";
import "@mysten/dapp-kit/dist/index.css";

const { networkConfig } = createNetworkConfig({
  mainnet: { url: getFullnodeUrl("mainnet") },
  testnet: { url: getFullnodeUrl("testnet") },
  devnet: { url: getFullnodeUrl("devnet") },
});

const defaultNetwork =
  (process.env.NEXT_PUBLIC_SUI_NETWORK as "mainnet" | "testnet" | "devnet") || "mainnet";

/** Connects external Sui wallets (Phantom, Slush, Suiet, …) via the Sui Wallet Standard. */
export function SuiWalletProvider({ children }: { children: ReactNode }) {
  return (
    <SuiClientProvider networks={networkConfig} defaultNetwork={defaultNetwork}>
      <WalletProvider
        autoConnect
        storageKey="openclu-sui-wallet"
        preferredWallets={["Phantom", "Slush", "Suiet"]}
      >
        {children}
      </WalletProvider>
    </SuiClientProvider>
  );
}
