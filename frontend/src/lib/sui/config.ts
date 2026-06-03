import { walrusEndpointsForNetwork } from "@/lib/sui/walrus-endpoints";

import type { SuiNetwork } from "@/lib/sui/tatum-rpc";

export type { SuiNetwork } from "@/lib/sui/tatum-rpc";

export function getSuiNetwork(): SuiNetwork {
  const raw = process.env.NEXT_PUBLIC_SUI_NETWORK?.trim() || "testnet";
  if (raw === "mainnet" || raw === "devnet") return raw;
  return "testnet";
}

export function getOpencluSkillPackageId(): string {
  const id = process.env.NEXT_PUBLIC_OPENCLU_SKILL_PACKAGE_ID?.trim();
  if (!id) {
    throw new Error(
      "Set NEXT_PUBLIC_OPENCLU_SKILL_PACKAGE_ID after deploying contracts/openclu_skill (see frontend/scripts/deploy-testnet.mjs).",
    );
  }
  return id;
}

export function getWalrusConfig() {
  const network = getSuiNetwork();
  return walrusEndpointsForNetwork(network === "mainnet" ? "mainnet" : "testnet");
}

export { getSuiRpcUrl, createSuiClient, createSuiRpcTransport } from "@/lib/sui/tatum-rpc";

/** Convert human SUI amount to MIST (1 SUI = 1e9 MIST). */
export function suiToMist(sui: string | number): bigint {
  if (typeof sui === "string" && !sui.trim()) return 0n;
  const n = typeof sui === "number" ? sui : Number.parseFloat(sui);
  if (!Number.isFinite(n) || n <= 0) return 0n;
  return BigInt(Math.round(n * 1_000_000_000));
}

export function tryGetOpencluSkillPackageId(): string | null {
  return process.env.NEXT_PUBLIC_OPENCLU_SKILL_PACKAGE_ID?.trim() || null;
}
