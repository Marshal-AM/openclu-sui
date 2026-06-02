"use client";

import { SealClient, SessionKey } from "@mysten/seal";
import type { SuiClient } from "@mysten/sui/client";
import { getOpencluSkillPackageId } from "@/lib/sui/config";
import { getSealServerConfigs, getSealThreshold } from "@/lib/seal/config";
import { wrapSuiClientForSeal } from "@/lib/seal/sui-client";

let sealClient: SealClient | null = null;
let sealClientSui: SuiClient | null = null;

export function getSealClient(suiClient: SuiClient): SealClient {
  const wrapped = wrapSuiClientForSeal(suiClient);
  if (!sealClient || sealClientSui !== wrapped) {
    sealClient = new SealClient({
      suiClient: wrapped,
      serverConfigs: getSealServerConfigs(),
      verifyKeyServers: false,
    });
    sealClientSui = wrapped;
  }
  return sealClient;
}

export function getSealThresholdValue(): number {
  return getSealThreshold();
}

export async function createSealSessionKey(
  suiClient: SuiClient,
  address: string,
  signPersonalMessage: (message: Uint8Array) => Promise<{ signature: string }>,
): Promise<SessionKey> {
  const sessionKey = await SessionKey.create({
    address,
    packageId: getOpencluSkillPackageId(),
    ttlMin: 10,
    suiClient,
  });

  const message = sessionKey.getPersonalMessage();
  const { signature } = await signPersonalMessage(message);
  await sessionKey.setPersonalMessageSignature(signature);
  return sessionKey;
}
