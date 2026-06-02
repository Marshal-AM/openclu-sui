import { preparePublishSkill } from "@/lib/sui/publish";
import type { SkillBundlePayload } from "@/lib/sui/entities";
import { getOpencluSkillPackageId, getSuiNetwork, suiToMist } from "@/lib/sui/config";
import { ensureUint8Array } from "@/lib/seal/bytes";
import { hexToBytes, SEAL_IDENTITY_BYTE_LENGTH } from "@/lib/seal/identity";

export const runtime = "nodejs";

function routeLog(step: string, detail?: string) {
  console.log(`[OpenClu/publish-prepare] ${step}`, detail ?? "");
}

const MAX_ENCRYPTED_BYTES = 80 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      ownerAddress?: string;
      skillSlug?: string;
      title?: string;
      description?: string;
      skillMd?: string;
      transcript?: unknown;
      frameAnnotations?: unknown[];
      recordedAt?: string;
      expertiseSource?: string;
      triggers?: string[];
      extraTags?: string[];
      sealIdentityPrefixHex?: string;
      encryptedBundleBase64?: string;
      listPriceSui?: string | null;
    };

    const ownerAddress = body.ownerAddress?.trim();
    const skillSlug = body.skillSlug?.trim();
    const title = body.title?.trim();
    const description = body.description?.trim();
    const skillMd = body.skillMd?.trim();
    const sealIdentityPrefixHex = body.sealIdentityPrefixHex?.trim();
    const encryptedBundleBase64 = body.encryptedBundleBase64?.trim();

    if (
      !ownerAddress ||
      !skillSlug ||
      !title ||
      !description ||
      !skillMd ||
      !sealIdentityPrefixHex ||
      !encryptedBundleBase64
    ) {
      return Response.json(
        {
          error:
            "Missing ownerAddress, skillSlug, title, description, skillMd, sealIdentityPrefixHex, or encryptedBundleBase64.",
        },
        { status: 400 },
      );
    }

    const sealIdentityPrefix = hexToBytes(sealIdentityPrefixHex);
    if (sealIdentityPrefix.length !== SEAL_IDENTITY_BYTE_LENGTH) {
      return Response.json(
        { error: `sealIdentityPrefixHex must be ${SEAL_IDENTITY_BYTE_LENGTH} bytes.` },
        { status: 400 },
      );
    }

    routeLog("POST received", `slug=${skillSlug} owner=${ownerAddress}`);

    const encryptedBundle = ensureUint8Array(
      new Uint8Array(Buffer.from(encryptedBundleBase64, "base64")),
    );
    routeLog("Encrypted bundle decoded", `${encryptedBundle.length} bytes`);
    if (encryptedBundle.length > MAX_ENCRYPTED_BYTES) {
      return Response.json(
        {
          error: `Encrypted bundle exceeds ${MAX_ENCRYPTED_BYTES / (1024 * 1024)} MB limit.`,
        },
        { status: 413 },
      );
    }

    const bundlePayload: SkillBundlePayload = {
      version: 1,
      skillSlug,
      title,
      description,
      skillMd,
      transcript: body.transcript ?? { segments: [] },
      frameAnnotations: Array.isArray(body.frameAnnotations) ? body.frameAnnotations : [],
      recordedAt: body.recordedAt ?? new Date().toISOString(),
      expertiseSource: body.expertiseSource,
      triggers: body.triggers,
      extraTags: body.extraTags,
    };

    if (!body.listPriceSui?.trim()) {
      return Response.json({ error: "listPriceSui is required for marketplace listing." }, { status: 400 });
    }
    const listPriceMist = suiToMist(body.listPriceSui);
    if (listPriceMist <= BigInt(0)) {
      return Response.json({ error: "List price must be greater than 0 SUI." }, { status: 400 });
    }
    routeLog("Calling preparePublishSkill (Walrus + Move tx build)");
    const prepared = await preparePublishSkill({
      network: getSuiNetwork(),
      packageId: getOpencluSkillPackageId(),
      ownerAddress,
      skillSlug,
      title,
      description,
      skillMd,
      transcript: bundlePayload.transcript,
      frameAnnotations: bundlePayload.frameAnnotations,
      recordedAt: bundlePayload.recordedAt,
      expertiseSource: bundlePayload.expertiseSource,
      triggers: bundlePayload.triggers,
      extraTags: bundlePayload.extraTags,
      bundlePayload,
      sealIdentityPrefix,
      encryptedBundle,
      listPriceMist,
    });

    routeLog("Prepare complete", `kind=${prepared.transactionKind} bundleBlob=${prepared.bundleWalrus.blobId}`);

    return Response.json({
      ok: true,
      bundleWalrus: prepared.bundleWalrus,
      sealIdentityHex: prepared.sealIdentityHex,
      transactionKind: prepared.transactionKind,
      transactionBytes: prepared.transactionBytes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Publish prepare failed.";
    console.error("[publish-prepare]", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
