import type { FrameAnnotation, Transcript } from "@/lib/skill-md";

export type PublishPrepareRequest = {
  ownerAddress: string;
  skillSlug: string;
  title: string;
  description: string;
  skillMd: string;
  transcript: Transcript;
  frameAnnotations: FrameAnnotation[];
  recordedAt: string;
  expertiseSource?: string;
  triggers?: string[];
  extraTags?: string[];
  sealIdentityPrefixHex: string;
  encryptedBundleBase64: string;
  /** Price in SUI; omit or 0 to publish without listing */
  listPriceSui?: string | null;
};

export type PublishPrepareResponse = {
  ok: true;
  bundleWalrus: { blobId: string; objectId?: string };
  sealIdentityHex: string;
  transactionKind: "create_only" | "create_and_list";
  transactionBytes: string;
};

export async function preparePublishSkillOnChain(
  body: PublishPrepareRequest,
): Promise<PublishPrepareResponse> {
  const res = await fetch("/api/skills/publish-prepare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as PublishPrepareResponse & {
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? `Publish prepare failed (${res.status})`);
  }

  return data;
}

export function transactionFromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return Uint8Array.from(bytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}
