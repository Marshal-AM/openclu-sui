"use client";

import type { SessionKey } from "@mysten/seal";
import type { SuiClient } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import type { SkillBundlePayload } from "@/lib/sui/entities";
import { readBytes } from "@/lib/sui/walrus-http";
import { getWalrusConfig } from "@/lib/sui/config";
import { getSealClient } from "@/lib/seal/client";
import { buildSealEncryptionId, SEAL_BUNDLE_SUFFIX } from "@/lib/seal/identity";
import { ensureUint8Array } from "@/lib/seal/bytes";
import { getOpencluSkillPackageId } from "@/lib/sui/config";

function skillAccessTarget(fn: string): `${string}::skill_access::${string}` {
  return `${getOpencluSkillPackageId()}::skill_access::${fn}`;
}

export async function buildSealApproveBuyerTxBytes(
  suiClient: SuiClient,
  purchaseObjectId: string,
  encryptionId: Uint8Array,
): Promise<Uint8Array> {
  const tx = new Transaction();
  tx.moveCall({
    target: skillAccessTarget("seal_approve_buyer"),
    arguments: [tx.pure.vector("u8", Array.from(encryptionId)), tx.object(purchaseObjectId)],
  });
  return tx.build({ client: suiClient, onlyTransactionKind: true });
}

export async function buildSealApproveCreatorTxBytes(
  suiClient: SuiClient,
  listingObjectId: string,
  encryptionId: Uint8Array,
): Promise<Uint8Array> {
  const tx = new Transaction();
  tx.moveCall({
    target: skillAccessTarget("seal_approve_creator"),
    arguments: [tx.pure.vector("u8", Array.from(encryptionId)), tx.object(listingObjectId)],
  });
  return tx.build({ client: suiClient, onlyTransactionKind: true });
}

export async function decryptSkillBundleFromWalrus(args: {
  suiClient: SuiClient;
  sessionKey: SessionKey;
  sealIdentityPrefix: Uint8Array;
  walrusBlobId: string;
  purchaseObjectId?: string;
  listingObjectId?: string;
}): Promise<SkillBundlePayload> {
  const walrus = getWalrusConfig();
  const encryptedBytes = ensureUint8Array(
    await readBytes(fetch, walrus.aggregatorUrl, {
      blobId: args.walrusBlobId,
    }),
  );

  const encryptionId = buildSealEncryptionId(args.sealIdentityPrefix, SEAL_BUNDLE_SUFFIX);
  const txBytes = args.purchaseObjectId
    ? await buildSealApproveBuyerTxBytes(args.suiClient, args.purchaseObjectId, encryptionId)
    : args.listingObjectId
      ? await buildSealApproveCreatorTxBytes(args.suiClient, args.listingObjectId, encryptionId)
      : (() => {
          throw new Error("purchaseObjectId or listingObjectId required for decryption");
        })();

  const client = getSealClient(args.suiClient);
  const decrypted = await client.decrypt({
    data: encryptedBytes,
    sessionKey: args.sessionKey,
    txBytes,
  });

  return JSON.parse(new TextDecoder().decode(decrypted)) as SkillBundlePayload;
}

export function bundleEncryptionIdFromPrefix(prefix: Uint8Array): {
  bytes: Uint8Array;
} {
  return { bytes: buildSealEncryptionId(prefix, SEAL_BUNDLE_SUFFIX) };
}
