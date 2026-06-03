"use client";

import { useCurrentAccount, useSignPersonalMessage, useSuiClient } from "@mysten/dapp-kit";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createSealSessionKey } from "@/lib/seal/client";
import { decryptSkillBundleFromWalrus } from "@/lib/seal/decrypt-skill";
import {
  getCachedDecryptedSkill,
  setCachedDecryptedSkill,
} from "@/lib/decrypted-skill-cache";
import { SEAL_IDENTITY_BYTE_LENGTH } from "@/lib/seal/identity";
import type { DecodedSkillListing, DecodedSkillPurchase } from "@/lib/sui/queries";

type SkillDecryptDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listing: DecodedSkillListing;
  purchase?: DecodedSkillPurchase | null;
  isCreator?: boolean;
  /** When true (purchased-skills page), persist decrypted markdown in localStorage. */
  persistCache?: boolean;
  /** Called after a successful decrypt that was persisted. */
  onCached?: () => void;
  /** Called after a fresh decrypt completes (including when not using cache). */
  onDecrypted?: () => void;
};

export function SkillDecryptDialog({
  open,
  onOpenChange,
  listing,
  purchase,
  isCreator,
  persistCache,
  onCached,
  onDecrypted,
}: SkillDecryptDialogProps) {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();
  const [loading, setLoading] = useState(false);
  const [skillMd, setSkillMd] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedFromCache, setLoadedFromCache] = useState(false);

  const purchaseId = purchase?.objectId;
  const walletAddress = account?.address;

  useEffect(() => {
    if (!open) {
      setSkillMd(null);
      setError(null);
      setLoading(false);
      setLoadedFromCache(false);
      return;
    }

    if (persistCache && purchaseId && walletAddress) {
      const cached = getCachedDecryptedSkill(walletAddress, purchaseId);
      if (cached) {
        setSkillMd(cached.skillMd);
        setError(null);
        setLoadedFromCache(true);
        return;
      }
    }

    setSkillMd(null);
    setError(null);
    setLoadedFromCache(false);
  }, [open, persistCache, purchaseId, walletAddress]);

  const decrypt = useCallback(async () => {
    const address = account?.address;
    if (!address) {
      toast.error("Connect your Sui wallet first.");
      return;
    }

    if (listing.sealIdentity.length !== SEAL_IDENTITY_BYTE_LENGTH) {
      setError("This listing was published before Seal encryption (legacy plaintext).");
      return;
    }

    if (!isCreator && !purchase) {
      setError("Purchase this skill before decrypting.");
      return;
    }

    setLoading(true);
    setError(null);
    setSkillMd(null);

    try {
      const sealPrefix = new Uint8Array(listing.sealIdentity);
      const sessionKey = await createSealSessionKey(client, address, async (message) => {
        const result = await signPersonalMessage({ message });
        return { signature: result.signature };
      });

      const bundle = await decryptSkillBundleFromWalrus({
        suiClient: client,
        sessionKey,
        sealIdentityPrefix: sealPrefix,
        walrusBlobId: listing.walrusBlobId,
        purchaseObjectId: purchase?.objectId,
        listingObjectId: isCreator ? listing.objectId : undefined,
      });

      const md = bundle.skillMd ?? "(No skill markdown in bundle)";
      setSkillMd(md);

      if (persistCache && purchase?.objectId) {
        setCachedDecryptedSkill(address, purchase.objectId, md, {
          title: listing.title,
          skillSlug: listing.skillSlug,
        });
        onCached?.();
      }
      onDecrypted?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Decryption failed.";
      setError(message);
      toast.error("Decrypt failed", { description: message });
    } finally {
      setLoading(false);
    }
  }, [
    account?.address,
    client,
    isCreator,
    listing,
    onCached,
    onDecrypted,
    persistCache,
    purchase,
    signPersonalMessage,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90vh,720px)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{listing.title}</DialogTitle>
          <DialogDescription>
            {skillMd
              ? loadedFromCache
                ? "Decrypted skill content (saved in this browser)."
                : "Decrypted skill content."
              : "Encrypted skill content — decrypt with Seal using your wallet session."}
          </DialogDescription>
        </DialogHeader>

        {!skillMd && !error ? (
          <p className="text-sm text-muted-foreground">
            Approve the wallet message to create a Seal session, then content is decrypted locally.
          </p>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {skillMd ? (
          <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/40 p-4 text-xs whitespace-pre-wrap">
            {skillMd}
          </pre>
        ) : null}

        <div className="flex justify-end gap-2">
          {!skillMd ? (
            <Button type="button" disabled={loading || !account} onClick={() => void decrypt()}>
              {loading ? "Decrypting…" : "Decrypt & view"}
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
