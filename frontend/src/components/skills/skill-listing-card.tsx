"use client";

import type { DecodedSkillListing } from "@/lib/sui/queries";
import type { SkillCatalogCard } from "@/lib/supabase/catalog-types";
import { catalogCardToListingLike } from "@/lib/supabase/catalog-types";
import { PurchaseSkillButton } from "@/components/skills/publish-skill-panel";
import { Button } from "@/components/ui/button";

function formatSui(mist: string): string {
  const n = Number(mist);
  if (!Number.isFinite(n)) return mist;
  return `${(n / 1e9).toFixed(4)} SUI`;
}

export type SkillListingCardProps = {
  card: SkillCatalogCard;
  accountAddress?: string;
  owned: boolean;
  onDecrypt: (listing: DecodedSkillListing, asCreator: boolean) => void;
  onPurchased?: () => void;
};

export function SkillListingCard({
  card,
  accountAddress,
  owned,
  onDecrypt,
  onPurchased,
}: SkillListingCardProps) {
  const listing = catalogCardToListingLike(card) as DecodedSkillListing;
  const isSeller =
    accountAddress?.toLowerCase() === card.seller.toLowerCase();
  const sealOk = card.hasSealEncryption;

  return (
    <li className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="font-medium">{card.title}</h2>
            <span className="shrink-0 rounded-md bg-primary/10 px-2.5 py-1 text-sm font-semibold text-primary">
              {formatSui(card.priceMist)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{card.skillSlug}</p>
          <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{card.description}</p>
          {!sealOk ? (
            <p className="mt-1 text-xs text-amber-600">Legacy listing (no Seal identity)</p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          {isSeller && sealOk ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onDecrypt(listing, true)}
            >
              Decrypt (seller)
            </Button>
          ) : null}
          {owned && sealOk ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onDecrypt(listing, false)}
            >
              Decrypt & view
            </Button>
          ) : !isSeller ? (
            <PurchaseSkillButton
              listingId={card.listingId}
              priceMist={BigInt(card.priceMist)}
              skillSlug={card.skillSlug}
              onPurchased={onPurchased}
            />
          ) : null}
        </div>
      </div>
    </li>
  );
}
