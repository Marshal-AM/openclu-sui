import {
  getTatumApiKey,
  getTatumDirectRpcUrl,
  type SuiNetwork,
} from "@/lib/sui/tatum-rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_429_RETRIES = 6;
const DEFAULT_RETRY_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const sec = Number.parseFloat(retryAfter);
    if (Number.isFinite(sec) && sec > 0) return Math.min(sec * 1000, 60_000);
  }
  return DEFAULT_RETRY_MS * (attempt + 1);
}

async function fetchTatumRpc(target: string, apiKey: string, body: string): Promise<Response> {
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body,
    });

    if (upstream.status !== 429) {
      return upstream;
    }

    lastResponse = upstream;
    if (attempt === MAX_429_RETRIES) break;

    const waitMs = retryDelayMs(upstream, attempt);
    console.warn(
      `[sui/rpc proxy] Tatum 429 — retry ${attempt + 1}/${MAX_429_RETRIES} in ${waitMs}ms`,
    );
    await sleep(waitMs);
  }

  return lastResponse!;
}

/**
 * Browser-safe Sui JSON-RPC proxy to Tatum (avoids CORS on x-api-key from localhost).
 */
export async function POST(request: Request) {
  const apiKey = getTatumApiKey();
  if (!apiKey) {
    return Response.json(
      { error: "TATUM_API_KEY is not set. Add it to frontend/.env." },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const rawNet = searchParams.get("network")?.trim();
  const network: SuiNetwork =
    rawNet === "mainnet" || rawNet === "testnet" || rawNet === "devnet"
      ? rawNet
      : "testnet";
  const target = getTatumDirectRpcUrl(network);
  const body = await request.text();

  let upstream: Response;
  try {
    upstream = await fetchTatumRpc(target, apiKey, body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream RPC request failed";
    console.error("[sui/rpc proxy]", message);
    return Response.json({ error: message }, { status: 502 });
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
