/**
 * Browser-local cache of decrypted skill markdown (plaintext).
 * Cleared when the user clears site data; scoped per wallet + purchase object.
 * Not suitable for shared devices.
 */

export type CachedDecryptedSkill = {
  skillMd: string;
  cachedAt: number;
  title?: string;
  skillSlug?: string;
};

const STORAGE_PREFIX = "openclu:decrypted-skill:";

function cacheKey(walletAddress: string, purchaseObjectId: string): string {
  return `${STORAGE_PREFIX}${walletAddress}:${purchaseObjectId}`;
}

export function getCachedDecryptedSkill(
  walletAddress: string | undefined,
  purchaseObjectId: string,
): CachedDecryptedSkill | null {
  if (typeof window === "undefined" || !walletAddress) return null;
  try {
    const raw = localStorage.getItem(cacheKey(walletAddress, purchaseObjectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedDecryptedSkill;
    if (typeof parsed.skillMd !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setCachedDecryptedSkill(
  walletAddress: string,
  purchaseObjectId: string,
  skillMd: string,
  meta?: { title?: string; skillSlug?: string },
): void {
  if (typeof window === "undefined") return;
  try {
    const entry: CachedDecryptedSkill = {
      skillMd,
      cachedAt: Date.now(),
      ...(meta?.title ? { title: meta.title } : {}),
      ...(meta?.skillSlug ? { skillSlug: meta.skillSlug } : {}),
    };
    localStorage.setItem(cacheKey(walletAddress, purchaseObjectId), JSON.stringify(entry));
  } catch {
    // Quota exceeded or private mode — ignore
  }
}

export function hasCachedDecryptedSkill(
  walletAddress: string | undefined,
  purchaseObjectId: string,
): boolean {
  return getCachedDecryptedSkill(walletAddress, purchaseObjectId) !== null;
}
