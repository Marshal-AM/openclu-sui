/** Public marketplace metadata — never skill content or ciphertext. */
export type SkillCatalogRow = {
  id: string;
  package_id: string;
  network: string;
  listing_id: string;
  record_id: string | null;
  skill_slug: string;
  title: string;
  description: string;
  seller_address: string;
  price_mist: number;
  active: boolean;
  listed_at_ms: number | null;
  published_at: string;
  tx_digest: string | null;
  walrus_blob_id: string | null;
  seal_encrypted: boolean;
  updated_at: string;
};

export type SkillCatalogUpsertInput = {
  packageId: string;
  network: string;
  listingId: string;
  recordId?: string | null;
  skillSlug: string;
  title: string;
  description: string;
  sellerAddress: string;
  priceMist: string | number | bigint;
  walrusBlobId?: string | null;
  txDigest?: string | null;
  listedAtMs?: number | string | null;
  sealEncrypted?: boolean;
};

export type SkillCatalogListResponse = {
  items: SkillCatalogRow[];
  total: number;
  page: number;
  pageSize: number;
};

/** UI-friendly catalog entry for marketplace cards + on-chain actions. */
export type SkillCatalogCard = {
  listingId: string;
  recordId: string | null;
  skillSlug: string;
  title: string;
  description: string;
  seller: string;
  priceMist: string;
  walrusBlobId: string;
  sealEncrypted: boolean;
  listedAtMs: string;
  publishedAt: string;
  /** Synthetic seal identity length flag — full bytes only on-chain for decrypt. */
  hasSealEncryption: boolean;
};

export function rowToCatalogCard(row: SkillCatalogRow): SkillCatalogCard {
  return {
    listingId: row.listing_id,
    recordId: row.record_id,
    skillSlug: row.skill_slug,
    title: row.title,
    description: row.description,
    seller: row.seller_address,
    priceMist: String(row.price_mist),
    walrusBlobId: row.walrus_blob_id ?? "",
    sealEncrypted: row.seal_encrypted,
    listedAtMs: row.listed_at_ms != null ? String(row.listed_at_ms) : "",
    publishedAt: row.published_at,
    hasSealEncryption: row.seal_encrypted,
  };
}

/** Minimal listing shape for buy/decrypt actions; seal bytes loaded from chain when decrypting. */
export function catalogCardToListingLike(card: SkillCatalogCard) {
  return {
    objectId: card.listingId,
    seller: card.seller,
    recordId: card.recordId ?? "",
    skillSlug: card.skillSlug,
    title: card.title,
    description: card.description,
    entityType: "skillBundle",
    walrusBlobId: card.walrusBlobId,
    sealIdentity: [] as number[],
    price: card.priceMist,
    active: true,
    listedAtMs: card.listedAtMs,
  };
}
