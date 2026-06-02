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
};

/**
 * Sign and execute via the wallet's native submit path when available.
 * dapp-kit's default hook signs then calls executeTransactionBlock on the app RPC,
 * which can fail after the wallet already submitted (false "Purchase failed" toast).
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

  const canWalletExecute =
    Boolean(wallet.features["sui:signAndExecuteTransaction"]) ||
    Boolean(wallet.features["sui:signAndExecuteTransactionBlock"]);

  if (canWalletExecute) {
    const suiWallet = wallet as WalletWithFeatures<Partial<SuiWalletFeatures>>;
    const result = await signAndExecuteTransaction(suiWallet, {
      transaction: transactionInput,
      account,
      chain,
    });
    return { digest: result.digest };
  }

  const suiWallet = wallet as WalletWithFeatures<Partial<SuiWalletFeatures>>;
  const { bytes, signature } = await signTransaction(suiWallet, {
      transaction: transactionInput,
      account,
      chain,
    },
  );

  const { digest } = await client.executeTransactionBlock({
    transactionBlock: bytes,
    signature,
  });

  if (!digest) {
    throw new Error("Transaction completed but no digest was returned.");
  }

  return { digest };
}

/** Pull a digest out of Sui RPC errors like TransactionDigest(abc123...). */
export function extractTransactionDigestFromError(message: string): string | null {
  const match = message.match(/TransactionDigest\(([A-Za-z0-9]+)\)/);
  return match?.[1] ?? null;
}
