import type { SuiClient } from "@mysten/sui/client";
import type { Transaction } from "@mysten/sui/transactions";
import type {
  SuiWalletFeatures,
  WalletAccount,
  WalletWithFeatures,
  WalletWithRequiredFeatures,
} from "@mysten/wallet-standard";
import { signAndExecuteTransaction, signTransaction } from "@mysten/wallet-standard";

export type SignAndExecuteResult = {
  digest: string;
  method: "wallet_execute" | "sign_then_rpc";
};

/** Soft gas buffer for warnings only — actual gas is usually much lower. */
const GAS_BUFFER_MIST = 5_000_000n; // 0.005 SUI

const SUI_COIN_TYPE = "0x2::sui::SUI";

/** Turn wallet / RPC failures into actionable messages (wallets often say only "Unexpected error"). */
export function formatWalletSignError(err: unknown, context?: { network?: string }): string {
  const net = context?.network ?? "testnet";
  const raw =
    err instanceof Error
      ? err.message
      : err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err);

  // Keep our balance / network pre-check messages intact.
  if (/App sees 0 SUI|listing price on Sui|Wallet balance is low/i.test(raw)) {
    return raw;
  }

  if (/user rejected|rejected from user|cancelled|canceled/i.test(raw)) {
    return "Transaction was cancelled in the wallet.";
  }

  if (/insufficient|not enough|gas/i.test(raw)) {
    return (
      `Not enough SUI on Sui ${net} for this transaction. ` +
      `If your wallet shows a balance elsewhere, switch the wallet to ${net} (testnet and mainnet are separate). ` +
      `${net === "testnet" ? "Get testnet SUI from a faucet if needed. " : ""}` +
      `Original: ${raw}`
    );
  }

  if (/wrong chain|chain mismatch|invalid chain|not supported on this chain/i.test(raw)) {
    return `Wallet network does not match the app (${net}). Switch the wallet to Sui ${net} and reconnect.`;
  }

  if (/Unexpected error/i.test(raw)) {
    return (
      `Wallet returned a generic error while signing. On another machine this is usually: ` +
      `(1) wallet on the wrong network — app expects Sui ${net}, ` +
      `(2) insufficient SUI for gas, ` +
      `(3) wallet popup blocked, or ` +
      `(4) an outdated wallet extension. Try Sui Wallet or Slush on ${net}, confirm the popup, then retry. ` +
      `Original: ${raw}`
    );
  }

  return raw || "Wallet signing failed.";
}

/**
 * Sign and execute via the wallet's native submit path when available.
 * Falls back to sign + RPC execute if the wallet-only path fails with a vague error.
 */
export async function signAndExecuteTransactionWithWallet(args: {
  wallet: WalletWithRequiredFeatures;
  account: WalletAccount;
  client: SuiClient;
  network: string;
  supportedIntents?: string[];
  transaction: Transaction;
}): Promise<SignAndExecuteResult> {
  const { wallet, account, client, network, supportedIntents, transaction } = args;

  assertWalletAccountChain(account, network);

  if (typeof transaction !== "string" && "setSenderIfNotSet" in transaction) {
    transaction.setSenderIfNotSet(account.address);
  }

  const chain = `sui:${network}` as `${string}:${string}`;
  const transactionInput = {
    async toJSON() {
      return typeof transaction === "string"
        ? transaction
        : await transaction.toJSON({ supportedIntents, client });
    },
  };

  const suiWallet = wallet as WalletWithFeatures<Partial<SuiWalletFeatures>>;
  const canWalletExecute =
    Boolean(wallet.features["sui:signAndExecuteTransaction"]) ||
    Boolean(wallet.features["sui:signAndExecuteTransactionBlock"]);

  if (canWalletExecute) {
    try {
      const result = await signAndExecuteTransaction(suiWallet, {
        transaction: transactionInput,
        account,
        chain,
      });
      return { digest: result.digest, method: "wallet_execute" };
    } catch (walletExecErr) {
      const msg = walletExecErr instanceof Error ? walletExecErr.message : String(walletExecErr);
      if (!/Unexpected error|internal error|failed/i.test(msg)) {
        throw walletExecErr;
      }
      console.warn(
        "[sign-and-execute] signAndExecuteTransaction failed, retrying sign + RPC:",
        msg,
      );
    }
  }

  const { bytes, signature } = await signTransaction(suiWallet, {
    transaction: transactionInput,
    account,
    chain,
  });

  const { digest } = await client.executeTransactionBlock({
    transactionBlock: bytes,
    signature,
  });

  if (!digest) {
    throw new Error("Transaction completed but no digest was returned.");
  }

  return { digest, method: "sign_then_rpc" };
}

function formatSuiAmount(mist: bigint): string {
  return `${(Number(mist) / 1e9).toFixed(4)} SUI`;
}

function zeroBalanceHint(network: string, owner: string): string {
  return (
    `App sees 0 SUI on Sui ${network} for ${owner.slice(0, 8)}…${owner.slice(-4)}. ` +
    `If your wallet shows a balance, switch the wallet to Sui ${network} — ` +
    `testnet and mainnet balances are separate.`
  );
}

/** Query native SUI balance via app RPC; null if the RPC call failed. */
export async function queryWalletSuiBalance(
  client: SuiClient,
  owner: string,
): Promise<bigint | null> {
  try {
    const { totalBalance } = await client.getBalance({ owner, coinType: SUI_COIN_TYPE });
    return BigInt(totalBalance);
  } catch (err) {
    console.warn("[wallet] getBalance failed:", err);
    return null;
  }
}

/** Wallet-standard account must include the app's Sui chain (e.g. sui:testnet). */
export function assertWalletAccountChain(account: WalletAccount, network: string): void {
  const expected = `sui:${network}` as `${string}:${string}`;
  if (account.chains.length > 0 && !account.chains.includes(expected)) {
    throw new Error(
      `Wallet account is not on Sui ${network} (active chains: ${account.chains.join(", ")}). ` +
        `Switch the wallet to ${network} and reconnect.`,
    );
  }
}

/**
 * Light gas check before signing. Only blocks when RPC reports 0 balance.
 * Skips when RPC is unavailable so the wallet can still attempt the tx.
 */
export async function assertWalletGasBalance(
  client: SuiClient,
  owner: string,
  network: string,
): Promise<{ totalMist: bigint }> {
  const balance = await queryWalletSuiBalance(client, owner);
  if (balance === null) {
    console.warn("[wallet] Skipping gas pre-check (RPC unavailable).");
    return { totalMist: 0n };
  }
  if (balance === 0n) {
    throw new Error(zeroBalanceHint(network, owner));
  }
  if (balance < GAS_BUFFER_MIST) {
    console.warn(
      `[wallet] Low SUI on ${network} (${formatSuiAmount(balance)}); wallet may still succeed.`,
    );
  }
  return { totalMist: balance };
}

/**
 * Purchase splits listing price from the gas coin.
 * Only blocks when balance is below the listing price (not price + a large gas reserve).
 */
export async function assertWalletBalanceForPurchase(
  client: SuiClient,
  owner: string,
  priceMist: bigint,
  network: string,
): Promise<{ totalMist: bigint }> {
  if (priceMist <= 0n) {
    throw new Error("Listing price is invalid.");
  }

  const balance = await queryWalletSuiBalance(client, owner);
  if (balance === null) {
    console.warn("[wallet] Skipping purchase balance pre-check (RPC unavailable).");
    return { totalMist: 0n };
  }
  if (balance === 0n) {
    throw new Error(zeroBalanceHint(network, owner));
  }
  if (balance < priceMist) {
    throw new Error(
      `Not enough SUI for the listing price on Sui ${network}. ` +
        `Need ${formatSuiAmount(priceMist)}, app sees ${formatSuiAmount(balance)}. ` +
        `If your wallet shows more, switch the wallet to ${network}.`,
    );
  }
  if (balance < priceMist + GAS_BUFFER_MIST) {
    console.warn(
      `[wallet] Balance ${formatSuiAmount(balance)} is tight for ` +
        `${formatSuiAmount(priceMist)} + gas; proceeding to wallet sign.`,
    );
  }
  return { totalMist: balance };
}

/** Pull a digest out of Sui RPC errors like TransactionDigest(abc123...). */
export function extractTransactionDigestFromError(message: string): string | null {
  const match = message.match(/TransactionDigest\(([A-Za-z0-9]+)\)/);
  return match?.[1] ?? null;
}
