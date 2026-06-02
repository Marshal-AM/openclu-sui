/**
 * Request testnet SUI from the official faucet for a recipient address.
 * Usage: node scripts/request-testnet-sui.mjs <0x...address>
 */
import { getFaucetHost, requestSuiFromFaucetV2 } from "@mysten/sui/faucet";

const recipient = process.argv[2]?.trim();
if (!recipient?.startsWith("0x")) {
  console.error("Usage: node scripts/request-testnet-sui.mjs <0x...address>");
  process.exit(2);
}

try {
  const host = getFaucetHost("testnet");
  console.log(`Requesting testnet SUI for ${recipient} via ${host} ...`);
  const result = await requestSuiFromFaucetV2({ host, recipient });
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
