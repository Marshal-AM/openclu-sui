"use client";

import Link from "next/link";
import { useCurrentAccount, useSuiClient } from "@mysten/dapp-kit";
import { useCallback, useEffect, useState } from "react";
import { GripVerticalIcon, LockIcon } from "lucide-react";
import { toast } from "sonner";
import type { PurchasedSkillEntry } from "@/app/api/skills/purchased/route";
import { hasCachedDecryptedSkill } from "@/lib/decrypted-skill-cache";
import { fetchPurchasedSkills } from "@/lib/supabase/purchased-client";
import { setSkillDragData } from "@/lib/agent-lab/drag-payload";
import { entryHasSeal, entryToListingForDecrypt } from "@/lib/agent-lab/purchased-entry";
import { useAgentLabStore } from "@/lib/agent-lab/agent-lab-store";
import { SEAL_IDENTITY_BYTE_LENGTH } from "@/lib/seal/identity";
import { querySkillListings } from "@/lib/sui/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AgentLabSkillsPanel() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const skillsRefreshKey = useAgentLabStore((s) => s.skillsRefreshKey);
  const openDecryptDialog = useAgentLabStore((s) => s.openDecryptDialog);

  const [entries, setEntries] = useState<PurchasedSkillEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decryptingId, setDecryptingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!account?.address) {
      setEntries([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const items = await fetchPurchasedSkills(account.address);
      setEntries(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load skills");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [account?.address]);

  useEffect(() => {
    void load();
  }, [load, skillsRefreshKey]);

  const onDragStart = (entry: PurchasedSkillEntry) => (e: React.DragEvent) => {
    const title = entry.catalog?.title ?? entry.purchase.skillSlug;
    setSkillDragData(e.dataTransfer, {
      purchaseObjectId: entry.purchase.objectId,
      title,
      skillSlug: entry.purchase.skillSlug,
    });
  };

  const startDecrypt = async (entry: PurchasedSkillEntry) => {
    if (!account?.address) {
      toast.error("Connect your wallet first.");
      return;
    }
    if (!entryHasSeal(entry)) {
      toast.error("This skill cannot be decrypted (no Seal identity).");
      return;
    }

    setDecryptingId(entry.purchase.objectId);
    try {
      let listing = entryToListingForDecrypt(entry);

      if (listing.sealIdentity.length !== SEAL_IDENTITY_BYTE_LENGTH) {
        const result = await querySkillListings(client, [listing.objectId]);
        const full = result[0];
        if (!full) throw new Error("Could not load listing from chain for decrypt.");
        listing = full;
      }

      openDecryptDialog(listing, entry.purchase);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to prepare decrypt");
    } finally {
      setDecryptingId(null);
    }
  };

  return (
    <div className="flex h-[180px] shrink-0 flex-col border-b bg-card/50">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div>
          <p className="text-sm font-medium">Your purchased skills</p>
          <p className="text-xs text-muted-foreground">
            Decrypt here, then drag onto the canvas to connect to the agent.
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden px-3 pb-3">
        {!account ? (
          <p className="text-sm text-muted-foreground">Connect your wallet to see purchased skills.</p>
        ) : null}
        {loading ? <p className="text-sm text-muted-foreground">Loading skills…</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {account && !loading && !error && entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No purchases yet.{" "}
            <Link href="/marketplace" className="text-primary underline-offset-4 hover:underline">
              Browse marketplace
            </Link>
          </p>
        ) : null}

        {entries.length > 0 ? (
          <ul className="flex gap-2">
            {entries.map((entry) => {
              const title = entry.catalog?.title ?? entry.purchase.skillSlug;
              const ready = hasCachedDecryptedSkill(
                account?.address,
                entry.purchase.objectId,
              );
              const isDecrypting = decryptingId === entry.purchase.objectId;

              return (
                <li key={entry.purchase.objectId}>
                  <div
                    draggable={ready}
                    onDragStart={ready ? onDragStart(entry) : undefined}
                    className={cn(
                      "flex w-[200px] items-start gap-2 rounded-lg border bg-card px-2 py-2 shadow-sm",
                      ready
                        ? "cursor-grab border-border hover:border-primary/40 active:cursor-grabbing"
                        : "border-dashed border-muted-foreground/40",
                    )}
                  >
                    <GripVerticalIcon
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        ready ? "text-muted-foreground" : "text-muted-foreground/30",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {entry.purchase.skillSlug}
                      </p>
                      {ready ? (
                        <Badge variant="secondary" className="mt-1.5 text-[10px]">
                          Ready
                        </Badge>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-1.5 h-7 gap-1 px-2 text-xs"
                          disabled={isDecrypting}
                          onClick={() => void startDecrypt(entry)}
                        >
                          <LockIcon className="size-3" />
                          {isDecrypting ? "Loading…" : "Decrypt"}
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
