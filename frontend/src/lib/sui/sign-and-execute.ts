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

const MIN_GAS_MIST = 50_000_000n; // 0.05 SUI

/** Turn wallet / RPC failures into actionable messages (wallets often say only "Unexpected error"). */
export function formatWalletSignError(err: unknown, context?: { network?: string }): string {
  const net = context?.network ?? "testnet";
  const raw =
    err instanceof Error
      ? err.message
      : err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err);

  if (/user rejected|rejected from user|cancelled|canceled/i.test(raw)) {
    return "Transaction was cancelled in the wallet.";
  }

  if (/insufficient|not enough|gas/i.test(raw)) {
    return `Not enough SUI for gas on ${net}. Get testnet SUI from the faucet, then retry.`;
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

/** Wallet-standard account must include the app's Sui chain (e.g. sui:testnet). */
export function assertWalletAccountChain(account: WalletAccount, network: string): void {
  const expected = `sui:${network}`;
  if (account.chains.length > 0 && !account.chains.includes(expected)) {
    throw new Error(
      `Wallet account is not on Sui ${network} (active chains: ${account.chains.join(", ")}). ` +
        `Switch the wallet to ${network} and reconnect.`,
    );
  }
}

/** Ensure wallet address has gas on the app RPC before signing. */
export async function assertWalletGasBalance(
  client: SuiClient,
  owner: string,
  minMist = MIN_GAS_MIST,
): Promise<{ totalMist: bigint }> {
  const { totalBalance } = await client.getBalance({ owner });
  const totalMist = BigInt(totalBalance);
  if (totalMist < minMist) {
    throw new Error(
      `Wallet balance is low (${formatSuiAmount(totalMist)}). ` +
        `Need at least ${formatSuiAmount(minMist)} on this network for gas.`,
    );
  }
  return { totalMist };
}

/** Purchase splits listing price from the gas coin — balance must cover both. */
export async function assertWalletBalanceForPurchase(
  client: SuiClient,
  owner: string,
  priceMist: bigint,
): Promise<{ totalMist: bigint }> {
  if (priceMist <= 0n) {
    throw new Error("Listing price is invalid.");
  }
  const required = priceMist + MIN_GAS_MIST;
  const { totalBalance } = await client.getBalance({ owner });
  const totalMist = BigInt(totalBalance);
  if (totalMist < required) {
    throw new Error(
      `Not enough SUI to buy this skill. Need ${formatSuiAmount(required)} ` +
        `(${formatSuiAmount(priceMist)} price + ${formatSuiAmount(MIN_GAS_MIST)} gas). ` +
        `Balance: ${formatSuiAmount(totalMist)}.`,
    );
  }
  return { totalMist };
}

/** Pull a digest out of Sui RPC errors like TransactionDigest(abc123...). */
export function extractTransactionDigestFromError(message: string): string | null {
  const match = message.match(/TransactionDigest\(([A-Za-z0-9]+)\)/);
  return match?.[1] ?? null;
}
