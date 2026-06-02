/** 32-byte Seal identity prefix stored on-chain. */
export const SEAL_IDENTITY_BYTE_LENGTH = 32;

export const SEAL_BUNDLE_SUFFIX = new TextEncoder().encode("bundle");
export const SEAL_RECORDING_SUFFIX = new TextEncoder().encode("recording");

export function generateSealIdentityPrefix(): Uint8Array {
  const bytes = new Uint8Array(SEAL_IDENTITY_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function sealIdentityPrefixToHex(prefix: Uint8Array): string {
  if (prefix.length !== SEAL_IDENTITY_BYTE_LENGTH) {
    throw new Error(`seal identity must be ${SEAL_IDENTITY_BYTE_LENGTH} bytes`);
  }
  return `0x${Array.from(prefix, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (normalized.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }
  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Full Seal encryption id: prefix || suffix (bundle / recording). */
export function buildSealEncryptionId(prefix: Uint8Array, suffix: Uint8Array): Uint8Array {
  const out = new Uint8Array(prefix.length + suffix.length);
  out.set(prefix, 0);
  out.set(suffix, prefix.length);
  return out;
}

export function bytesToHexRaw(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Seal encrypt `id` must be hex (with 0x) per Seal SDK / docs. */
export function sealEncryptionIdToHex(bytes: Uint8Array): string {
  return `0x${bytesToHexRaw(bytes)}`;
}

export function sealIdentityFromListingField(value: unknown): Uint8Array | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    const nums = value.map((v) => Number(v));
    if (nums.length !== SEAL_IDENTITY_BYTE_LENGTH) return null;
    return new Uint8Array(nums);
  }
  if (typeof value === "string") {
    try {
      const bytes = hexToBytes(value);
      if (bytes.length !== SEAL_IDENTITY_BYTE_LENGTH) return null;
      return bytes;
    } catch {
      return null;
    }
  }
  return null;
}
