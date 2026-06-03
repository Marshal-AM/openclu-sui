"use client";

import { useCurrentAccount, useSuiClient } from "@mysten/dapp-kit";
import {
  listSkillPurchasesByOwner,
  querySkillListings,
  type DecodedSkillListing,
  type DecodedSkillPurchase,
} from "@/lib/sui/queries";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SkillDecryptDialog } from "@/components/skills/skill-decrypt-dialog";
import { SkillListingCard } from "@/components/skills/skill-listing-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tryGetOpencluSkillPackageId } from "@/lib/sui/config";
import { SEAL_IDENTITY_BYTE_LENGTH } from "@/lib/seal/identity";
import { rowToCatalogCard, type SkillCatalogCard } from "@/lib/supabase/catalog-types";
import { fetchMySkillCatalog, fetchSkillCatalog } from "@/lib/supabase/catalog-client";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 12;

type TabId = "browse" | "mine";

export default function MarketplacePage() {
  const packageId = tryGetOpencluSkillPackageId();
  const account = useCurrentAccount();
  const client = useSuiClient();
  const [tab, setTab] = useState<TabId>("browse");
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [cards, setCards] = useState<SkillCatalogCard[]>([]);
  const [total, setTotal] = useState(0);
  const [myCards, setMyCards] = useState<SkillCatalogCard[]>([]);
  const [purchases, setPurchases] = useState<DecodedSkillPurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decryptListing, setDecryptListing] = useState<DecodedSkillListing | null>(null);
  const [decryptPurchase, setDecryptPurchase] = useState<DecodedSkillPurchase | null>(null);
  const [decryptAsCreator, setDecryptAsCreator] = useState(false);
  const [decryptLoading, setDecryptLoading] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [searchDebounced, tab]);

  const refreshPurchases = useCallback(async () => {
    if (!packageId || !account?.address) {
      setPurchases([]);
      return;
    }
    try {
      const owned = await listSkillPurchasesByOwner(client, packageId, account.address, 100);
      setPurchases(owned);
    } catch {
      setPurchases([]);
    }
  }, [account?.address, client, packageId]);

  const loadBrowse = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSkillCatalog({
        q: searchDebounced || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setCards(res.items.map(rowToCatalogCard));
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load marketplace");
      setCards([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, searchDebounced]);

  const loadMine = useCallback(async () => {
    if (!account?.address) {
      setMyCards([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchMySkillCatalog(account.address);
      setMyCards(rows.map(rowToCatalogCard));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load your skills");
      setMyCards([]);
    } finally {
      setLoading(false);
    }
  }, [account?.address]);

  useEffect(() => {
    void refreshPurchases();
  }, [refreshPurchases]);

  useEffect(() => {
    if (tab === "browse") void loadBrowse();
    else void loadMine();
  }, [tab, loadBrowse, loadMine]);

  const purchaseByListing = useMemo(() => {
    const map = new Map<string, DecodedSkillPurchase>();
    for (const p of purchases) {
      map.set(p.listingId, p);
    }
    return map;
  }, [purchases]);

  const openDecrypt = useCallback(
    async (listing: DecodedSkillListing, asCreator: boolean) => {
      setDecryptAsCreator(asCreator);
      setDecryptPurchase(asCreator ? null : (purchaseByListing.get(listing.objectId) ?? null));

      if (listing.sealIdentity.length === SEAL_IDENTITY_BYTE_LENGTH) {
        setDecryptListing(listing);
        return;
      }

      setDecryptLoading(true);
      try {
        const result = await querySkillListings(client, [listing.objectId]);
        const full = result[0];
        if (!full) {
          throw new Error("Could not load listing from chain for decrypt.");
        }
        setDecryptListing(full);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load listing";
        setError(message);
      } finally {
        setDecryptLoading(false);
      }
    },
    [client, purchaseByListing],
  );

  const displayCards = tab === "browse" ? cards : myCards;
  const pageCount = tab === "browse" ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : 1;

  if (!packageId) {
    return (
      <div className="flex w-full flex-col gap-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Skill marketplace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Deploy the Move package and set <code>NEXT_PUBLIC_OPENCLU_SKILL_PACKAGE_ID</code> in{" "}
            <code>.env</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Skill marketplace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse indexed listings. Buy and decrypt still use Sui + Walrus + Seal.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void refreshPurchases();
            if (tab === "browse") void loadBrowse();
            else void loadMine();
          }}
        >
          Refresh
        </Button>
      </div>

      <div className="flex gap-2 border-b">
        <button
          type="button"
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            tab === "browse"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
          onClick={() => setTab("browse")}
        >
          Browse
        </button>
        <button
          type="button"
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            tab === "mine"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
          onClick={() => setTab("mine")}
        >
          Published
        </button>
      </div>

      {tab === "browse" ? (
        <div className="flex gap-2">
          <Input
            type="search"
            placeholder="Search title, slug, or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1"
          />
        </div>
      ) : null}

      {!account ? (
        <p className="text-sm text-amber-700 dark:text-amber-200">
          Connect your Sui wallet to purchase, decrypt, or view published skills.
        </p>
      ) : null}

      {tab === "mine" && !account ? (
        <p className="text-sm text-muted-foreground">Connect a wallet to see skills you published.</p>
      ) : null}

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {decryptLoading ? (
        <p className="text-sm text-muted-foreground">Loading listing for decrypt…</p>
      ) : null}

      {!loading && !error && displayCards.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {tab === "browse"
            ? "No listings in catalog yet. Publish from Record (requires Supabase env + SQL migration)."
            : "No published skills for this wallet yet."}
        </p>
      ) : null}

      <ul className="flex flex-col gap-4">
        {displayCards.map((card) => (
          <SkillListingCard
            key={card.listingId}
            card={card}
            accountAddress={account?.address}
            owned={Boolean(purchaseByListing.get(card.listingId))}
            onDecrypt={(listing, asCreator) => void openDecrypt(listing, asCreator)}
            onPurchased={() => {
              void refreshPurchases();
              if (tab === "browse") void loadBrowse();
            }}
          />
        ))}
      </ul>

      {tab === "browse" && total > PAGE_SIZE ? (
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page} of {pageCount} ({total} listings)
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}

      {decryptListing ? (
        <SkillDecryptDialog
          open={Boolean(decryptListing)}
          onOpenChange={(open) => {
            if (!open) {
              setDecryptListing(null);
              setDecryptPurchase(null);
            }
          }}
          listing={decryptListing}
          purchase={decryptPurchase}
          isCreator={decryptAsCreator}
        />
      ) : null}
    </div>
  );
}
