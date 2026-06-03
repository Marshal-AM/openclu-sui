"use client";

import { SkillDecryptDialog } from "@/components/skills/skill-decrypt-dialog";
import { useAgentLabStore } from "@/lib/agent-lab/agent-lab-store";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { toast } from "sonner";

export function AgentLabDecryptHost() {
  const account = useCurrentAccount();
  const open = useAgentLabStore((s) => s.decryptDialogOpen);
  const listing = useAgentLabStore((s) => s.decryptListing);
  const purchase = useAgentLabStore((s) => s.decryptPurchase);
  const autoAttachCatalog = useAgentLabStore((s) => s.autoAttachCatalog);
  const closeDecryptDialog = useAgentLabStore((s) => s.closeDecryptDialog);
  const bumpSkillsRefresh = useAgentLabStore((s) => s.bumpSkillsRefresh);
  const attachSkillFromCache = useAgentLabStore((s) => s.attachSkillFromCache);
  const clearAutoAttach = useAgentLabStore((s) => s.clearAutoAttach);

  const tryAutoAttach = () => {
    if (!autoAttachCatalog || !purchase || !account?.address) return;
    const ok = attachSkillFromCache(account.address, purchase.objectId, autoAttachCatalog);
    if (ok) {
      toast.success(`"${autoAttachCatalog.title}" connected to agent`);
      clearAutoAttach();
    }
  };

  if (!listing || !purchase) return null;

  return (
    <SkillDecryptDialog
      open={open}
      onOpenChange={(v) => {
        if (!v) closeDecryptDialog();
      }}
      listing={listing}
      purchase={purchase}
      isCreator={false}
      persistCache
      onCached={() => {
        bumpSkillsRefresh();
        tryAutoAttach();
      }}
      onDecrypted={() => {
        bumpSkillsRefresh();
        tryAutoAttach();
      }}
    />
  );
}
