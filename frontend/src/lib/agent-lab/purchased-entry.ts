import type { PurchasedSkillEntry } from "@/app/api/skills/purchased/route";
import { catalogCardToListingLike } from "@/lib/supabase/catalog-types";
import type { DecodedSkillListing } from "@/lib/sui/queries";
import { SEAL_IDENTITY_BYTE_LENGTH } from "@/lib/seal/identity";

export function entryToListingForDecrypt(entry: PurchasedSkillEntry): DecodedSkillListing {
  const { purchase, catalog } = entry;
  const title = catalog?.title ?? purchase.skillSlug;
  const description =
    catalog?.description ??
    "Catalog metadata unavailable — decrypt still works via your on-chain purchase receipt.";

  const listingFromCatalog = catalog
    ? (catalogCardToListingLike(catalog) as DecodedSkillListing)
    : null;

  const listing: DecodedSkillListing = listingFromCatalog ?? {
    objectId: purchase.listingId,
    seller: purchase.seller,
    recordId: purchase.recordId,
    skillSlug: purchase.skillSlug,
    title,
    description,
    entityType: purchase.entityType,
    walrusBlobId: purchase.walrusBlobId,
    sealIdentity: purchase.sealIdentity,
    price: purchase.pricePaid,
    active: true,
    listedAtMs: purchase.purchasedAtMs,
  };

  if (listing.sealIdentity.length === SEAL_IDENTITY_BYTE_LENGTH) {
    return listing;
  }

  return {
    ...listing,
    sealIdentity: purchase.sealIdentity,
  };
}

export function entryHasSeal(entry: PurchasedSkillEntry): boolean {
  const listing = entryToListingForDecrypt(entry);
  return (
    listing.sealIdentity.length === SEAL_IDENTITY_BYTE_LENGTH ||
    entry.purchase.sealIdentity.length === SEAL_IDENTITY_BYTE_LENGTH
  );
}
