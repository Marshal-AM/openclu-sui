/**
 * Integration test: Seal encrypt → Walrus upload → Sui tx build (no wallet sign).
 *
 * Usage (from frontend/):
 *   node scripts/test-publish-pipeline.mjs
 *
 * Requires .env with NEXT_PUBLIC_OPENCLU_SKILL_PACKAGE_ID, NEXT_PUBLIC_SUI_NETWORK=testnet
 * Optional: TEST_OWNER_ADDRESS (defaults to zero address for tx build only)
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(join(root, ".env"));
loadEnvFile(join(root, ".env.local"));

function ensureUint8Array(bytes) {
  return Uint8Array.from(bytes);
}

function wrapSuiClientForSeal(client) {
  if (client.__opencluSealWrapped) return client;
  const core = client.core;
  if (!core) {
    client.__opencluSealWrapped = true;
    return client;
  }

  const normalizeContent = async (content) => {
    if (!content) return undefined;
    const bytes = content instanceof Uint8Array ? content : await content;
    return ensureUint8Array(bytes);
  };

  const origGetObject = core.getObject?.bind(core);
  if (origGetObject) {
    core.getObject = async (options) => {
      const result = await origGetObject(options);
      if (result?.object?.content) {
        return {
          ...result,
          object: {
            ...result.object,
            content: await normalizeContent(result.object.content),
          },
        };
      }
      return result;
    };
  }

  const origGetObjects = core.getObjects?.bind(core);
  if (origGetObjects) {
    core.getObjects = async (options) => {
      const result = await origGetObjects(options);
      if (result?.objects) {
        const objects = await Promise.all(
          result.objects.map(async (o) => {
            if (o instanceof Error) return o;
            if (o?.content) {
              return { ...o, content: await normalizeContent(o.content) };
            }
            return o;
          }),
        );
        return { ...result, objects };
      }
      return result;
    };
  }

  const origGetDynamicField = core.getDynamicField?.bind(core);
  if (origGetDynamicField) {
    core.getDynamicField = async (options) => {
      const nameBcs =
        options.name?.bcs instanceof Uint8Array
          ? ensureUint8Array(options.name.bcs)
          : options.name?.bcs;
      const opts =
        nameBcs !== options.name?.bcs
          ? { ...options, name: { ...options.name, bcs: nameBcs } }
          : options;
      const result = await origGetDynamicField(opts);
      const valueBcs = result.dynamicField?.value?.bcs;
      if (valueBcs instanceof Uint8Array) {
        return {
          ...result,
          dynamicField: {
            ...result.dynamicField,
            value: {
              ...result.dynamicField.value,
              bcs: ensureUint8Array(valueBcs),
            },
          },
        };
      }
      return result;
    };
  }

  client.__opencluSealWrapped = true;
  return client;
}

function sealServerConfigs() {
  const override = process.env.NEXT_PUBLIC_SEAL_KEY_SERVERS?.trim();
  if (override) return JSON.parse(override);
  return [
    {
      objectId: "0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98",
      aggregatorUrl: "https://seal-aggregator-testnet.mystenlabs.com",
      weight: 1,
    },
    {
      objectId: "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75",
      weight: 1,
    },
  ];
}

function buildEncryptionIdHex(prefixHex, suffix) {
  const prefix = prefixHex.replace(/^0x/, "");
  const suffixHex = Buffer.from(suffix, "utf8").toString("hex");
  return `0x${prefix}${suffixHex}`;
}

async function main() {
  const packageId = process.env.NEXT_PUBLIC_OPENCLU_SKILL_PACKAGE_ID?.trim();
  if (!packageId) {
    console.error("FAIL: set NEXT_PUBLIC_OPENCLU_SKILL_PACKAGE_ID in .env");
    process.exit(1);
  }

  const ownerAddress =
    process.env.TEST_OWNER_ADDRESS?.trim() ||
    "0x0000000000000000000000000000000000000000000000000000000000000001";

  const { SuiClient } = await import("@mysten/sui/client");
  const { SealClient } = await import("@mysten/seal");
  const { Transaction } = await import("@mysten/sui/transactions");
  const { BcsReader } = await import("@mysten/bcs");

  console.log("1) BcsReader subarray regression…");
  const parent = new Uint8Array(64);
  parent.fill(7);
  const slice = parent.subarray(8, 40);
  try {
    new BcsReader(slice);
    console.log("   WARN: default BcsReader accepted subarray (unexpected on this runtime)");
  } catch (e) {
    console.log("   default BcsReader rejects subarray:", e.message);
  }
  new BcsReader(ensureUint8Array(slice));
  console.log("   ensureUint8Array + BcsReader OK");

  console.log("2) Seal encrypt…");
  const rpc =
    process.env.NEXT_PUBLIC_SUI_RPC_URL?.trim() || "https://fullnode.testnet.sui.io:443";
  const sui = wrapSuiClientForSeal(new SuiClient({ url: rpc }));

  const sealIdentity = crypto.getRandomValues(new Uint8Array(32));
  const sealIdentityHex = `0x${Buffer.from(sealIdentity).toString("hex")}`;
  const bundleIdHex = buildEncryptionIdHex(sealIdentityHex, "bundle");

  const bundlePayload = {
    version: 1,
    skillSlug: "pipeline-test",
    title: "Pipeline test",
    description: "Automated publish pipeline test",
    skillMd: "# Test\n\nAutomated.",
    transcript: { full_text: "", segments: [] },
    frameAnnotations: [],
    recordedAt: new Date().toISOString(),
  };

  const seal = new SealClient({
    suiClient: sui,
    serverConfigs: sealServerConfigs(),
    verifyKeyServers: false,
  });

  let encryptedBundle;
  try {
    const result = await seal.encrypt({
      threshold: Number(process.env.NEXT_PUBLIC_SEAL_THRESHOLD || "2"),
      packageId,
      id: bundleIdHex,
      data: ensureUint8Array(new TextEncoder().encode(JSON.stringify(bundlePayload))),
      aad: ensureUint8Array(new Uint8Array(0)),
    });
    encryptedBundle = ensureUint8Array(result.encryptedObject);
    console.log(`   Seal OK: ${encryptedBundle.length} bytes ciphertext`);
  } catch (err) {
    console.error("FAIL Seal encrypt:", err);
    process.exit(1);
  }

  console.log("3) Walrus upload…");
  const publisher = "https://publisher.walrus-testnet.walrus.space";
  const epochs = "3";
  const url = new URL("/v1/blobs", publisher);
  url.searchParams.set("epochs", epochs);
  url.searchParams.set("permanent", "true");
  url.searchParams.set("send_object_to", ownerAddress);

  const walrusRes = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: encryptedBundle,
  });

  if (!walrusRes.ok) {
    console.error("FAIL Walrus:", walrusRes.status, await walrusRes.text());
    process.exit(1);
  }

  const walrusJson = await walrusRes.json();
  const blobId =
    walrusJson?.newlyCreated?.blobObject?.blobId ??
    walrusJson?.alreadyCertified?.blobId ??
    walrusJson?.blobId;
  if (!blobId) {
    console.error("FAIL Walrus: no blobId in response", walrusJson);
    process.exit(1);
  }
  console.log(`   Walrus OK: blobId=${blobId}`);

  console.log("4) Sui transaction build (prepare, no sign)…");
  const { createHash } = await import("node:crypto");
  const canonical = JSON.stringify(bundlePayload);
  const payloadHash = Array.from(createHash("sha256").update(canonical).digest());

  const tx = new Transaction();
  const now = BigInt(Date.now());
  tx.moveCall({
    target: `${packageId}::skill_marketplace::create_record_and_list`,
    arguments: [
      tx.pure.string("pipeline-test"),
      tx.pure.string("skillBundle"),
      tx.pure.string(blobId),
      tx.pure.string(""),
      tx.pure.vector("u8", payloadHash),
      tx.pure.vector("u8", Array.from(sealIdentity)),
      tx.pure.string("Pipeline test"),
      tx.pure.string("Automated publish pipeline test"),
      tx.pure.vector("string", ["skillSlug", "entityType", "sealEncrypted"]),
      tx.pure.vector("string", ["pipeline-test", "skillBundle", "true"]),
      tx.pure.u64(now),
      tx.pure.u64(100_000_000n),
      tx.object.clock(),
    ],
  });

  tx.setSender(ownerAddress);
  const txBytes = await tx.build({ client: sui });
  const bytes = ensureUint8Array(txBytes);

  try {
    Transaction.from(bytes);
    console.log(`   Sui tx build OK: ${bytes.length} bytes`);
  } catch (err) {
    console.error("FAIL Transaction.from:", err);
    process.exit(1);
  }

  console.log("\nAll pipeline steps passed.");
  console.log(`  packageId=${packageId}`);
  console.log(`  sealIdentity=${sealIdentityHex}`);
  console.log(`  walrusBlobId=${blobId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
