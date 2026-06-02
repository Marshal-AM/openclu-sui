import type { SuiClient } from "@mysten/sui/client";

export interface DecodedSkillRecord {
  objectId: string;
  creator: string;
  skillSlug: string;
  entityType: string;
  walrusBlobId: string;
  walrusObjectId: string;
  payloadHash: number[];
  sealIdentity: number[];
  title: string;
  description: string;
  attrs: Record<string, string>;
  createdAtMs: string;
  updatedAtMs: string;
}

export interface DecodedSkillListing {
  objectId: string;
  seller: string;
  recordId: string;
  skillSlug: string;
  title: string;
  description: string;
  entityType: string;
  walrusBlobId: string;
  sealIdentity: number[];
  price: string;
  active: boolean;
  listedAtMs: string;
}

export interface DecodedSkillPurchase {
  objectId: string;
  buyer: string;
  seller: string;
  listingId: string;
  recordId: string;
  skillSlug: string;
  entityType: string;
  walrusBlobId: string;
  sealIdentity: number[];
  pricePaid: string;
  purchasedAtMs: string;
}

export function skillRecordType(packageId: string): string {
  return `${packageId}::skill_record::SkillRecord`;
}

export function skillListingType(packageId: string): string {
  return `${packageId}::skill_marketplace::SkillListing`;
}

export function skillPurchaseType(packageId: string): string {
  return `${packageId}::skill_marketplace::SkillPurchase`;
}

export async function listSkillRecordsByOwner(
  client: SuiClient,
  packageId: string,
  owner: string,
  limit = 50,
): Promise<DecodedSkillRecord[]> {
  return listObjectsByType(client, owner, skillRecordType(packageId), decodeSkillRecord, limit);
}

export async function listSkillPurchasesByOwner(
  client: SuiClient,
  packageId: string,
  owner: string,
  limit = 50,
): Promise<DecodedSkillPurchase[]> {
  return listObjectsByType(client, owner, skillPurchaseType(packageId), decodeSkillPurchase, limit);
}

export async function listListingIdsFromEvents(
  client: SuiClient,
  packageId: string,
  limit = 100,
): Promise<string[]> {
  const eventType = `${packageId}::skill_marketplace::SkillListed`;

  const ids: string[] = [];
  const seen = new Set<string>();
  let cursor: Parameters<SuiClient["queryEvents"]>[0]["cursor"];

  do {
    const page = await client.queryEvents({
      query: { MoveEventType: eventType },
      limit: Math.min(limit, 50),
      cursor: cursor ?? null,
    });

    for (const item of page.data) {
      const parsed = item as { parsedJson?: { listing_id?: string } };
      const listingId = parsed?.parsedJson?.listing_id;
      if (!listingId || seen.has(listingId)) continue;
      seen.add(listingId);
      ids.push(listingId);
      if (ids.length >= limit) return ids;
    }

    cursor = page.nextCursor;
    if (!page.hasNextPage) break;
  } while (cursor);

  return ids;
}

export async function listActiveSkillListings(
  client: SuiClient,
  packageId: string,
  limit = 100,
): Promise<DecodedSkillListing[]> {
  const ids = await listListingIdsFromEvents(client, packageId, limit);
  return querySkillListings(client, ids);
}

/** Query shared SkillListing objects (requires fullnode with object query). */
export async function querySkillListings(
  client: SuiClient,
  listingIds: string[],
): Promise<DecodedSkillListing[]> {
  if (listingIds.length === 0) return [];
  const result = await client.multiGetObjects({
    ids: listingIds,
    options: { showContent: true },
  });
  const out: DecodedSkillListing[] = [];
  for (const item of result) {
    const decoded = decodeSkillListing(item);
    if (decoded?.active) out.push(decoded);
  }
  return out;
}

async function listObjectsByType<T>(
  client: SuiClient,
  owner: string,
  structType: string,
  decode: (item: unknown) => T | null,
  limit: number,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null | undefined;
  const pageLimit = Math.min(limit, 50);

  do {
    const page = await client.getOwnedObjects({
      owner,
      limit: pageLimit,
      filter: { StructType: structType },
      options: { showContent: true, showType: true },
      cursor: cursor ?? undefined,
    });

    for (const item of page.data) {
      const decoded = decode(item);
      if (decoded) out.push(decoded);
      if (out.length >= limit) return out;
    }

    cursor = page.nextCursor;
    if (!page.hasNextPage) break;
  } while (cursor);

  return out;
}

export function decodeSkillRecord(item: unknown): DecodedSkillRecord | null {
  const fields = objectFields(item);
  if (!fields) return null;

  return {
    objectId: objectId(item),
    creator: String(fields.creator ?? ""),
    skillSlug: String(fields.skill_slug ?? ""),
    entityType: String(fields.entity_type ?? ""),
    walrusBlobId: String(fields.walrus_blob_id ?? ""),
    walrusObjectId: String(fields.walrus_object_id ?? ""),
    payloadHash: vectorToNumbers(fields.payload_hash),
    sealIdentity: vectorToNumbers(fields.seal_identity),
    title: String(fields.title ?? ""),
    description: String(fields.description ?? ""),
    attrs: attrsFromVectors(fields.attr_keys, fields.attr_values),
    createdAtMs: String(fields.created_at_ms ?? ""),
    updatedAtMs: String(fields.updated_at_ms ?? ""),
  };
}

export function decodeSkillListing(item: unknown): DecodedSkillListing | null {
  const fields = objectFields(item);
  if (!fields) return null;

  return {
    objectId: objectId(item),
    seller: String(fields.seller ?? ""),
    recordId: String(fields.record_id ?? ""),
    skillSlug: String(fields.skill_slug ?? ""),
    title: String(fields.title ?? ""),
    description: String(fields.description ?? ""),
    entityType: String(fields.entity_type ?? ""),
    walrusBlobId: String(fields.walrus_blob_id ?? ""),
    sealIdentity: vectorToNumbers(fields.seal_identity),
    price: String(fields.price ?? ""),
    active: Boolean(fields.active),
    listedAtMs: String(fields.listed_at_ms ?? ""),
  };
}

export function decodeSkillPurchase(item: unknown): DecodedSkillPurchase | null {
  const fields = objectFields(item);
  if (!fields) return null;

  return {
    objectId: objectId(item),
    buyer: String(fields.buyer ?? ""),
    seller: String(fields.seller ?? ""),
    listingId: String(fields.listing_id ?? ""),
    recordId: String(fields.record_id ?? ""),
    skillSlug: String(fields.skill_slug ?? ""),
    entityType: String(fields.entity_type ?? ""),
    walrusBlobId: String(fields.walrus_blob_id ?? ""),
    sealIdentity: vectorToNumbers(fields.seal_identity),
    pricePaid: String(fields.price_paid ?? ""),
    purchasedAtMs: String(fields.purchased_at_ms ?? ""),
  };
}

export function findPurchaseForListing(
  purchases: DecodedSkillPurchase[],
  listingId: string,
): DecodedSkillPurchase | undefined {
  return purchases.find((p) => p.listingId === listingId);
}

function objectFields(item: unknown): Record<string, unknown> | null {
  const data = (item as { data?: { content?: { fields?: Record<string, unknown> } } })?.data;
  return data?.content?.fields ?? null;
}

function objectId(item: unknown): string {
  return String((item as { data?: { objectId?: string } })?.data?.objectId ?? "");
}

function attrsFromVectors(keys: unknown, values: unknown): Record<string, string> {
  const keyList = Array.isArray(keys) ? keys.map(String) : [];
  const valueList = Array.isArray(values) ? values.map(String) : [];
  const out: Record<string, string> = {};
  for (let i = 0; i < keyList.length; i += 1) {
    out[keyList[i]!] = valueList[i] ?? "";
  }
  return out;
}

function vectorToNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => Number(v));
}
