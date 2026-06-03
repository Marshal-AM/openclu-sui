import { SuiClient, SuiHTTPTransport } from "@mysten/sui/client";

const GATEWAYS = {
  mainnet: "https://sui-mainnet.gateway.tatum.io",
  testnet: "https://sui-testnet.gateway.tatum.io",
  devnet: "https://sui-devnet.gateway.tatum.io",
};

export function getTatumApiKey() {
  return (
    process.env.TATUM_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_TATUM_API_KEY?.trim() ||
    ""
  );
}

export function getSuiRpcUrl(network = "testnet") {
  const explicit = process.env.NEXT_PUBLIC_SUI_RPC_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return GATEWAYS[network] ?? GATEWAYS.testnet;
}

export function createSuiClient(network = process.env.NEXT_PUBLIC_SUI_NETWORK?.trim() || "testnet") {
  const url = getSuiRpcUrl(network);
  const apiKey = getTatumApiKey();
  const transport = new SuiHTTPTransport(
    apiKey
      ? { url, rpc: { url, headers: { "x-api-key": apiKey } } }
      : { url },
  );
  return new SuiClient({ transport, network });
}
