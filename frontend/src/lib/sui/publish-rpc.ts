import type { PublishFlowLogger } from "@/lib/publish-flow-log";
import { createThrottledSuiClient, getPublishRpcGapMs } from "@/lib/sui/tatum-rpc";

export { createThrottledSuiClient as createPublishSuiClient, getPublishRpcGapMs };

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pause between major publish steps to avoid Tatum RPC 429 bursts. */
export async function publishFlowDelay(
  logger: PublishFlowLogger | undefined,
  step: string,
  ms = getPublishRpcGapMs(),
): Promise<void> {
  const sec = Math.round(ms / 1000);
  logger?.log("sui", `Waiting ${sec}s (${step})…`, {
    detail: "Tatum RPC rate limit — spacing on-chain requests",
  });
  await sleep(ms);
}
