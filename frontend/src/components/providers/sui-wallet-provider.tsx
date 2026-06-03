"use client";

import { createNetworkConfig, SuiClientProvider, WalletProvider } from "@mysten/dapp-kit";
import { type ReactNode } from "react";
import { getSuiNetwork } from "@/lib/sui/config";
import { createSuiClient, getSuiRpcUrl, type SuiNetwork } from "@/lib/sui/tatum-rpc";
import "@mysten/dapp-kit/dist/index.css";

const { networkConfig } = createNetworkConfig({
  mainnet: { url: getSuiRpcUrl("mainnet") },
  testnet: { url: getSuiRpcUrl("testnet") },
  devnet: { url: getSuiRpcUrl("devnet") },
});

/** Must match getSuiNetwork() — previously defaulted to mainnet when env was unset. */
const defaultNetwork = getSuiNetwork();

/** Connects external Sui wallets (Phantom, Slush, Suiet, …) via the Sui Wallet Standard. */
export function SuiWalletProvider({ children }: { children: ReactNode }) {
  return (
    <SuiClientProvider
      networks={networkConfig}
      defaultNetwork={defaultNetwork}
      createClient={(network) => createSuiClient(network as SuiNetwork)}
    >
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
