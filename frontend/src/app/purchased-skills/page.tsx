"use client";

import { useCurrentAccount, useSuiClient } from "@mysten/dapp-kit";
import { useCallback, useEffect, useState } from "react";
import { PurchasedSkillCard } from "@/components/skills/purchased-skill-card";
import { SkillDecryptDialog } from "@/components/skills/skill-decrypt-dialog";
import { Button } from "@/components/ui/button";
import { tryGetOpencluSkillPackageId } from "@/lib/sui/config";
import { SEAL_IDENTITY_BYTE_LENGTH } from "@/lib/seal/identity";
import { querySkillListings } from "@/lib/sui/queries";
import type { DecodedSkillListing, DecodedSkillPurchase } from "@/lib/sui/queries";
import type { PurchasedSkillEntry } from "@/app/api/skills/purchased/route";
import { fetchPurchasedSkills } from "@/lib/supabase/purchased-client";

export default function PurchasedSkillsPage() {
  const packageId = tryGetOpencluSkillPackageId();
  const account = useCurrentAccount();
  const client = useSuiClient();
  const [entries, setEntries] = useState<PurchasedSkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decryptListing, setDecryptListing] = useState<DecodedSkillListing | null>(null);
  const [decryptPurchase, setDecryptPurchase] = useState<DecodedSkillPurchase | null>(null);
  const [decryptLoading, setDecryptLoading] = useState(false);

  const load = useCallback(async () => {
    if (!account?.address) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const items = await fetchPurchasedSkills(account.address);
      setEntries(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load purchased skills");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [account?.address]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDecrypt = useCallback(
    async (listing: DecodedSkillListing, purchase: DecodedSkillPurchase) => {
      setDecryptPurchase(purchase);

      if (listing.sealIdentity.length === SEAL_IDENTITY_BYTE_LENGTH) {
        setDecryptListing(listing);
        return;
      }

      setDecryptLoading(true);
      try {
        const result = await querySkillListings(client, [listing.objectId]);
        const full = result[0];
        if (!full) throw new Error("Could not load listing from chain for decrypt.");
        setDecryptListing(full);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load listing for decrypt");
      } finally {
        setDecryptLoading(false);
      }
    },
    [client],
  );

  if (!packageId) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold">My Purchased Skills</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Set <code>NEXT_PUBLIC_OPENCLU_SKILL_PACKAGE_ID</code> in <code>.env</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">My Purchased Skills</h1>
          <p className="text-sm text-muted-foreground">
            Skills you bought on the marketplace. Decrypt uses your on-chain purchase receipt + Walrus +
            Seal (no skill content is stored in Supabase).
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {!account ? (
        <p className="text-sm text-amber-700 dark:text-amber-200">
          Connect your Sui wallet to see purchased skills.
        </p>
      ) : null}

      {loading ? <p className="text-sm text-muted-foreground">Loading purchases…</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {decryptLoading ? (
        <p className="text-sm text-muted-foreground">Loading listing for decrypt…</p>
      ) : null}

      {!loading && account && !error && entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No purchases yet. Browse the marketplace and buy a skill to see it here.
        </p>
      ) : null}

      <ul className="flex flex-col gap-4">
        {entries.map((entry) => (
          <PurchasedSkillCard
            key={entry.purchase.objectId}
            entry={entry}
            onDecrypt={(listing, purchase) => void openDecrypt(listing, purchase)}
          />
        ))}
      </ul>

      {decryptListing && decryptPurchase ? (
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
          isCreator={false}
        />
      ) : null}
    </div>
  );
}
