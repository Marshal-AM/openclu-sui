import { getSuiNetwork, getWalrusConfig } from "@/lib/sui/config";

export function getSuiTxExplorerUrl(digest: string): string {
  const network = getSuiNetwork();
  if (network === "mainnet") {
    return `https://suiscan.xyz/mainnet/tx/${digest}`;
  }
  return `https://suiscan.xyz/testnet/tx/${digest}`;
}

export function getSuiObjectExplorerUrl(objectId: string): string {
  const network = getSuiNetwork();
  if (network === "mainnet") {
    return `https://suiscan.xyz/mainnet/object/${objectId}`;
  }
  return `https://suiscan.xyz/testnet/object/${objectId}`;
}

export function getWalrusBlobExplorerUrl(blobId: string): string {
  const { aggregatorUrl } = getWalrusConfig();
  const base = aggregatorUrl.endsWith("/") ? aggregatorUrl : `${aggregatorUrl}/`;
  return new URL(`v1/blobs/${encodeURIComponent(blobId)}`, base).toString();
}
