import { getOpencluSkillPackageId, getSuiNetwork } from "@/lib/sui/config";

export function getSealThreshold(): number {
  const raw = process.env.NEXT_PUBLIC_SEAL_THRESHOLD?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 2;
  return Number.isFinite(n) && n > 0 ? n : 2;
}

/** Verified Seal testnet key servers (https://seal-docs.wal.app/Pricing). */
export function getSealServerConfigs(): Array<{
  objectId: string;
  weight: number;
  aggregatorUrl?: string;
}> {
  const override = process.env.NEXT_PUBLIC_SEAL_KEY_SERVERS?.trim();
  if (override) {
    return JSON.parse(override) as Array<{ objectId: string; weight: number; aggregatorUrl?: string }>;
  }

  const network = getSuiNetwork();
  if (network === "mainnet") {
    return [
      {
        objectId: "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75",
        weight: 1,
      },
      {
        objectId: "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8",
        weight: 1,
      },
    ];
  }

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

export function getSealPackageIdBytes(): Uint8Array {
  const hex = getOpencluSkillPackageId().replace(/^0x/i, "");
  return Uint8Array.from(hex.match(/.{1,2}/g)!.map((byte) => Number.parseInt(byte, 16)));
}
