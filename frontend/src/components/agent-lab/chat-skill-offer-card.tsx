"use client";

import { useCurrentAccount, useSuiClient } from "@mysten/dapp-kit";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PurchaseSkillButton } from "@/components/skills/publish-skill-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { catalogCardToListingLike } from "@/lib/supabase/catalog-types";
import type { SkillCatalogSearchResult } from "@/lib/supabase/skill-search";
import { hasCachedDecryptedSkill } from "@/lib/decrypted-skill-cache";
import { useAgentLabStore } from "@/lib/agent-lab/agent-lab-store";
import { fetchPurchasedSkills } from "@/lib/supabase/purchased-client";
import { SEAL_IDENTITY_BYTE_LENGTH } from "@/lib/seal/identity";
import { querySkillListings, type DecodedSkillListing, type DecodedSkillPurchase } from "@/lib/sui/queries";
import type { PurchasedSkillEntry } from "@/app/api/skills/purchased/route";

function formatSui(mist: string): string {
  const n = Number(mist);
  if (!Number.isFinite(n)) return mist;
  return `${(n / 1e9).toFixed(4)} SUI`;
}

type ChatSkillOfferCardProps = {
  offer: SkillCatalogSearchResult;
  onRefreshPurchases?: () => void;
};

export function ChatSkillOfferCard({ offer, onRefreshPurchases }: ChatSkillOfferCardProps) {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const attachedSkills = useAgentLabStore((s) => s.attachedSkills);
  const openDecryptDialog = useAgentLabStore((s) => s.openDecryptDialog);
  const requestAutoAttach = useAgentLabStore((s) => s.requestAutoAttach);
  const attachSkillFromCache = useAgentLabStore((s) => s.attachSkillFromCache);
  const bumpSkillsRefresh = useAgentLabStore((s) => s.bumpSkillsRefresh);

  const [purchase, setPurchase] = useState<DecodedSkillPurchase | null>(null);
  const [loadingPurchase, setLoadingPurchase] = useState(false);

  const loadPurchase = useCallback(async () => {
    if (!account?.address) {
      setPurchase(null);
      return;
    }
    setLoadingPurchase(true);
    try {
      const items = await fetchPurchasedSkills(account.address);
      const match = items.find((e) => e.purchase.listingId === offer.listingId);
      setPurchase(match?.purchase ?? null);
    } catch {
      setPurchase(null);
    } finally {
      setLoadingPurchase(false);
    }
  }, [account?.address, offer.listingId]);

  useEffect(() => {
    void loadPurchase();
  }, [loadPurchase]);

  const listing: DecodedSkillListing = catalogCardToListingLike(offer) as DecodedSkillListing;
  const isAttached = attachedSkills.some(
    (s) => s.purchaseObjectId === purchase?.objectId || s.skillSlug === offer.skillSlug,
  );
  const isCached =
    purchase && account?.address
      ? hasCachedDecryptedSkill(account.address, purchase.objectId)
      : false;

  const resolveFullListing = async (): Promise<DecodedSkillListing> => {
    if (listing.sealIdentity.length === SEAL_IDENTITY_BYTE_LENGTH) return listing;
    const result = await querySkillListings(client, [listing.objectId]);
    return result[0] ?? listing;
  };

  const startDecrypt = async () => {
    if (!purchase) return;
    setLoadingPurchase(true);
    try {
      const full = await resolveFullListing();
      requestAutoAttach(offer);
      openDecryptDialog(full, purchase);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to open decrypt");
    } finally {
      setLoadingPurchase(false);
    }
  };

  const addToAgent = () => {
    if (!purchase || !account?.address) return;
    const ok = attachSkillFromCache(account.address, purchase.objectId, offer);
    if (ok) {
      toast.success(`"${offer.title}" connected to agent`);
    } else {
      toast.error("Decrypt the skill first.");
    }
  };

  const onPurchased = async (purchaseObjectId: string) => {
    bumpSkillsRefresh();
    onRefreshPurchases?.();

    try {
      const items = await fetchPurchasedSkills(account!.address);
      const entry: PurchasedSkillEntry | undefined =
        items.find((e) => e.purchase.objectId === purchaseObjectId) ??
        items.find((e) => e.purchase.listingId === offer.listingId);

      const p = entry?.purchase;
      if (!p) {
        toast.error("Purchase succeeded but receipt not found yet. Refresh and try decrypt.");
        return;
      }

      setPurchase(p);
      const full = await resolveFullListing();
      requestAutoAttach(offer);
      openDecryptDialog(full, p);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed after purchase");
    }
  };

  if (!offer.hasSealEncryption) {
    return (
      <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
        Legacy listing — cannot purchase or decrypt via Seal.
      </div>
    );
  }

  return (
    <div className="mt-3 w-full max-w-sm rounded-lg border bg-background/80 p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{offer.title}</p>
          <p className="truncate text-xs text-muted-foreground">{offer.skillSlug}</p>
        </div>
        <Badge variant="secondary" className="shrink-0 text-[10px]">
          {Math.round(offer.similarity * 100)}% match
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{offer.description}</p>
      <p className="mt-2 text-sm font-medium text-primary">{formatSui(offer.priceMist)}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {!account ? (
          <p className="text-xs text-muted-foreground">Connect wallet to purchase.</p>
        ) : isAttached ? (
          <Badge variant="outline">Connected to agent</Badge>
        ) : loadingPurchase ? (
          <Button type="button" size="sm" disabled>
            Loading…
          </Button>
        ) : purchase && isCached ? (
          <Button type="button" size="sm" onClick={addToAgent}>
            Add to agent
          </Button>
        ) : purchase ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => void startDecrypt()}>
            Decrypt & attach
          </Button>
        ) : (
          <PurchaseSkillButton
            listingId={offer.listingId}
            priceMist={BigInt(offer.priceMist)}
            skillSlug={offer.skillSlug}
            onPurchased={(id) => void onPurchased(id)}
          />
        )}
      </div>
    </div>
  );
}
