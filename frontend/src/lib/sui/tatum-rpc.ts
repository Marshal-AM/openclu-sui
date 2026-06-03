import { SuiClient, SuiHTTPTransport } from "@mysten/sui/client";

export type SuiNetwork = "mainnet" | "testnet" | "devnet";

const BROWSER_RPC_PROXY_PATH = "/api/sui/rpc";

function resolveSuiNetwork(): SuiNetwork {
  const raw = process.env.NEXT_PUBLIC_SUI_NETWORK?.trim() || "testnet";
  if (raw === "mainnet" || raw === "devnet") return raw;
  return "testnet";
}

const TATUM_SUI_GATEWAYS: Record<SuiNetwork, string> = {
  testnet: "https://sui-testnet.gateway.tatum.io",
  mainnet: "https://sui-mainnet.gateway.tatum.io",
  devnet: "https://sui-devnet.gateway.tatum.io",
};

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/** Tatum API key — server/proxy only (never attach in browser fetch to Tatum; use RPC proxy). */
export function getTatumApiKey(): string | undefined {
  return (
    process.env.TATUM_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_TATUM_API_KEY?.trim() ||
    undefined
  );
}

/** Direct Tatum gateway URL (server-side and RPC proxy upstream). */
export function getTatumDirectRpcUrl(network?: SuiNetwork): string {
  const explicit = process.env.NEXT_PUBLIC_SUI_RPC_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const net = network ?? resolveSuiNetwork();
  return TATUM_SUI_GATEWAYS[net];
}

/** RPC URL for SuiClient: same-origin proxy in the browser, direct Tatum on the server. */
export function getSuiRpcUrl(network?: SuiNetwork): string {
  if (isBrowser()) {
    return BROWSER_RPC_PROXY_PATH;
  }
  return getTatumDirectRpcUrl(network);
}

export function createSuiRpcTransport(network?: SuiNetwork): SuiHTTPTransport {
  const url = getSuiRpcUrl(network);

  if (isBrowser()) {
    return new SuiHTTPTransport({ url });
  }

  const apiKey = getTatumApiKey();
  const directUrl = getTatumDirectRpcUrl(network);
  if (apiKey) {
    return new SuiHTTPTransport({
      url: directUrl,
      rpc: { url: directUrl, headers: { "x-api-key": apiKey } },
    });
  }
  return new SuiHTTPTransport({ url: directUrl });
}

export function createSuiClient(network?: SuiNetwork): SuiClient {
  const net = network ?? resolveSuiNetwork();
  return new SuiClient({
    network: net,
    transport: createSuiRpcTransport(net),
  });
}

/** Gap between JSON-RPC calls during publish (Seal makes many requests). Default 5s. */
export function getPublishRpcGapMs(): number {
  const raw = process.env.NEXT_PUBLIC_PUBLISH_RPC_GAP_MS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 5000;
  return Number.isFinite(n) && n >= 0 ? n : 5000;
}

function createThrottledFetch(minGapMs: number): typeof fetch {
  let lastAt = 0;
  let chain: Promise<void> = Promise.resolve();

  return (input, init) => {
    chain = chain.then(async () => {
      const elapsed = Date.now() - lastAt;
      if (lastAt > 0 && elapsed < minGapMs) {
        await new Promise((r) => setTimeout(r, minGapMs - elapsed));
      }
      lastAt = Date.now();
    });
    return chain.then(() => fetch(input, init));
  };
}

/** Browser client for publish/Seal — serializes RPC through the proxy with a minimum gap. */
export function createThrottledSuiClient(
  minGapMs = getPublishRpcGapMs(),
  network?: SuiNetwork,
): SuiClient {
  const net = network ?? resolveSuiNetwork();
  const url = getSuiRpcUrl(net);
  const transport = new SuiHTTPTransport({
    url,
    fetch: createThrottledFetch(minGapMs),
  });
  return new SuiClient({ network: net, transport });
}
