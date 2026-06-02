"use client";

import type { SuiClient } from "@mysten/sui/client";
import type { SkillBundlePayload } from "@/lib/sui/entities";
import { canonicalJson } from "@/lib/sui/canonical-json";
import { ensureUint8Array } from "@/lib/seal/bytes";
import { getSealClient, getSealThresholdValue } from "@/lib/seal/client";
import {
  buildSealEncryptionId,
  SEAL_BUNDLE_SUFFIX,
  sealEncryptionIdToHex,
  sealIdentityPrefixToHex,
} from "@/lib/seal/identity";
export { generateSealIdentityPrefix } from "@/lib/seal/identity";
import { getOpencluSkillPackageId } from "@/lib/sui/config";
import type { PublishFlowLogger } from "@/lib/publish-flow-log";

export interface EncryptSkillResult {
  sealIdentityPrefix: Uint8Array;
  sealIdentityHex: string;
  bundleEncryptionId: Uint8Array;
  bundleEncryptionIdHex: string;
  encryptedBundle: Uint8Array;
}

export async function encryptSkillPayload(
  suiClient: SuiClient,
  sealIdentityPrefix: Uint8Array,
  bundle: SkillBundlePayload,
  logger?: PublishFlowLogger,
): Promise<EncryptSkillResult> {
  const log = logger?.log;
  const packageId = getOpencluSkillPackageId();
  const threshold = getSealThresholdValue();

  log?.("seal", "Starting Seal encryption (skill bundle only)", {
    detail: `package=${packageId} threshold=${threshold}`,
  });

  const client = getSealClient(suiClient);
  const bundleEncryptionId = buildSealEncryptionId(sealIdentityPrefix, SEAL_BUNDLE_SUFFIX);
  const bundleIdHex = sealEncryptionIdToHex(bundleEncryptionId);
  const bundlePlain = ensureUint8Array(new TextEncoder().encode(canonicalJson(bundle)));

  log?.("seal", "Encrypting skill bundle JSON", {
    detail: `plaintext=${bundlePlain.length} bytes id=${bundleIdHex.slice(0, 18)}…`,
  });

  const { encryptedObject: encryptedBundleRaw } = await client.encrypt({
    threshold,
    packageId,
    id: bundleIdHex,
    data: bundlePlain,
    aad: ensureUint8Array(new Uint8Array(0)),
  });
  const encryptedBundle = ensureUint8Array(encryptedBundleRaw);

  log?.("seal", "Seal encryption complete", {
    level: "success",
    detail: `ciphertext=${encryptedBundle.length} bytes seal_identity=${sealIdentityPrefixToHex(sealIdentityPrefix)}`,
  });

  return {
    sealIdentityPrefix,
    sealIdentityHex: sealIdentityPrefixToHex(sealIdentityPrefix),
    bundleEncryptionId,
    bundleEncryptionIdHex: bundleIdHex,
    encryptedBundle,
  };
}
