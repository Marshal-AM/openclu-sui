"use client";

import type { DecodedSkillListing, DecodedSkillPurchase } from "@/lib/sui/queries";
import type { PurchasedSkillEntry } from "@/app/api/skills/purchased/route";
import { catalogCardToListingLike } from "@/lib/supabase/catalog-types";
import { hasCachedDecryptedSkill } from "@/lib/decrypted-skill-cache";
import { SEAL_IDENTITY_BYTE_LENGTH } from "@/lib/seal/identity";
import { Button } from "@/components/ui/button";

function formatSui(mist: string): string {
  const n = Number(mist);
  if (!Number.isFinite(n)) return mist;
  return `${(n / 1e9).toFixed(4)} SUI`;
}

export type PurchasedSkillCardProps = {
  entry: PurchasedSkillEntry;
  walletAddress: string | undefined;
  cacheVersion: number;
  onDecrypt: (listing: DecodedSkillListing, purchase: DecodedSkillPurchase) => void;
  onView: (listing: DecodedSkillListing, purchase: DecodedSkillPurchase) => void;
};

export function PurchasedSkillCard({
  entry,
  walletAddress,
  cacheVersion,
  onDecrypt,
  onView,
}: PurchasedSkillCardProps) {
  void cacheVersion;

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

  const sealOk =
    listing.sealIdentity.length === SEAL_IDENTITY_BYTE_LENGTH ||
    purchase.sealIdentity.length === SEAL_IDENTITY_BYTE_LENGTH;

  const listingForDecrypt: DecodedSkillListing =
    listing.sealIdentity.length === SEAL_IDENTITY_BYTE_LENGTH
      ? listing
      : {
          ...listing,
          sealIdentity: purchase.sealIdentity,
        };

  const isCached = hasCachedDecryptedSkill(walletAddress, purchase.objectId);

  return (
    <li className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="font-medium">{title}</h2>
            <span className="shrink-0 rounded-md bg-emerald-500/10 px-2.5 py-1 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              Paid {formatSui(purchase.pricePaid)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{purchase.skillSlug}</p>
          <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{description}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Seller: {purchase.seller.slice(0, 6)}…{purchase.seller.slice(-4)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {sealOk ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                isCached
                  ? onView(listingForDecrypt, purchase)
                  : onDecrypt(listingForDecrypt, purchase)
              }
            >
              {isCached ? "View" : "Decrypt & view"}
            </Button>
          ) : (
            <p className="text-xs text-amber-600">Cannot decrypt (no Seal)</p>
          )}
        </div>
      </div>
    </li>
  );
}
