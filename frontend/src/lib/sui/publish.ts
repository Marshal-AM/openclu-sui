import { buildCreateRecordAndListTx, buildListSkillTx } from "./move-tx";
import {
  buildSkillRecordInput,
  type SkillBundlePayload,
  type SkillEntityType,
  walrusRefFromHttp,
} from "./entities";
import { storeBytes, type FetchLike } from "./walrus-http";
import { getSuiRpcUrl } from "@/lib/sui/config";
import { walrusEndpointsForNetwork } from "@/lib/sui/walrus-endpoints";
import { SEAL_IDENTITY_BYTE_LENGTH } from "@/lib/seal/identity";

export interface PublishSkillInput {
  fetch?: FetchLike;
  network: "mainnet" | "testnet" | "devnet";
  packageId: string;
  ownerAddress: string;
  skillSlug: string;
  title: string;
  description: string;
  skillMd: string;
  transcript: unknown;
  frameAnnotations: unknown[];
  recordedAt: string;
  expertiseSource?: string;
  triggers?: string[];
  extraTags?: string[];
  /** Plaintext bundle used for on-chain payload hash only. */
  bundlePayload: SkillBundlePayload;
  sealIdentityPrefix: Uint8Array;
  encryptedBundle: Uint8Array;
  listPriceMist?: bigint | null;
  walrusEpochs?: number;
}

export interface PublishSkillPrepared {
  bundleWalrus: { blobId: string; objectId?: string };
  sealIdentityHex: string;
  recordInput: Awaited<ReturnType<typeof buildSkillRecordInput>>;
  transactionKind: "create_only" | "create_and_list";
  /** Base64 serialized transaction bytes for wallet signing */
  transactionBytes: string;
}

function publishLog(step: string, detail?: string) {
  console.log(`[OpenClu/walrus+sui] ${step}`, detail ?? "");
}

export async function preparePublishSkill(
  input: PublishSkillInput,
): Promise<PublishSkillPrepared> {
  if (input.sealIdentityPrefix.length !== SEAL_IDENTITY_BYTE_LENGTH) {
    throw new Error(`sealIdentityPrefix must be ${SEAL_IDENTITY_BYTE_LENGTH} bytes`);
  }

  publishLog("preparePublishSkill", `slug=${input.skillSlug} owner=${input.ownerAddress}`);

  const fetchImpl = input.fetch ?? globalThis.fetch.bind(globalThis);
  const walrus = walrusEndpointsForNetwork(
    input.network === "mainnet" ? "mainnet" : "testnet",
  );
  const epochs = input.walrusEpochs ?? walrus.epochs;

  publishLog("Walrus upload (encrypted bundle)", `${input.encryptedBundle.length} bytes`);
  const bundleRef = await storeBytes(fetchImpl, walrus.publisherUrl, input.encryptedBundle, {
    epochs,
    permanent: true,
    sendObjectTo: input.ownerAddress,
    contentType: "application/octet-stream",
  });

  publishLog("Bundle stored on Walrus", `blobId=${bundleRef.blobId}`);

  const sealIdentityHex = `0x${Array.from(input.sealIdentityPrefix, (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("")}`;

  const recordInput = await buildSkillRecordInput({
    skillSlug: input.skillSlug,
    entityType: "skillBundle" satisfies SkillEntityType,
    title: input.title,
    description: input.description,
    payload: input.bundlePayload,
    walrus: walrusRefFromHttp(bundleRef),
    sealIdentity: input.sealIdentityPrefix,
    attrs: {
      sealEncrypted: "true",
    },
  });

  const listPrice = input.listPriceMist ?? null;
  if (!listPrice || listPrice <= BigInt(0)) {
    throw new Error("List price is required — publish always creates a marketplace listing.");
  }
  publishLog("Building Sui transaction", `create_record_and_list price=${listPrice} MIST`);
  const tx = buildCreateRecordAndListTx(input.packageId, recordInput, listPrice);

  tx.setSender(input.ownerAddress);
  const { SuiClient } = await import("@mysten/sui/client");
  const client = new SuiClient({ url: getSuiRpcUrl() });
  const bytes = await tx.build({ client });
  publishLog("Transaction built", `${bytes.length} bytes (awaiting wallet signature)`);

  return {
    bundleWalrus: walrusRefFromHttp(bundleRef),
    sealIdentityHex,
    recordInput,
    transactionKind: "create_and_list",
    transactionBytes: Buffer.from(bytes).toString("base64"),
  };
}

export function buildListExistingRecordTx(
  packageId: string,
  recordObjectId: string,
  priceMist: bigint,
) {
  return buildListSkillTx({ packageId, recordId: recordObjectId, priceMist });
}
