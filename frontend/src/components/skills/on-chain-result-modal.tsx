"use client";

import type { SuiClient } from "@mysten/sui/client";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getSuiObjectExplorerUrl,
  getSuiTxExplorerUrl,
  getWalrusBlobExplorerUrl,
} from "@/lib/sui/explorers";
import { cn } from "@/lib/utils";

export type OnChainResultRow = {
  label: string;
  value: string;
  href?: string;
  mono?: boolean;
};

export type OnChainResultSection = {
  title: string;
  rows: OnChainResultRow[];
};

export type OnChainResultModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  sections: OnChainResultSection[];
};

function CopyableRow({ label, value, href, mono = true }: OnChainResultRow) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy");
    }
  }, [value]);

  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex items-start gap-2">
        <p
          className={cn(
            "min-w-0 flex-1 break-all text-sm leading-snug",
            mono && "font-mono text-[13px]",
          )}
        >
          {value}
        </p>
        <div className="flex shrink-0 gap-0.5">
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => void copy()} title="Copy">
            {copied ? <CheckIcon className="size-3.5 text-emerald-600" /> : <CopyIcon className="size-3.5" />}
          </Button>
          {href ? (
            <Button type="button" variant="ghost" size="icon-sm" render={<a href={href} target="_blank" rel="noreferrer" />} title="Open">
              <ExternalLinkIcon className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function OnChainResultModal({
  open,
  onOpenChange,
  title,
  description,
  sections,
}: OnChainResultModalProps) {
  const allValues = sections.flatMap((s) => s.rows.map((r) => `${r.label}: ${r.value}`)).join("\n");

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(allValues);
      toast.success("Copied all details");
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90vh,720px)] overflow-y-auto sm:max-w-lg" showCloseButton>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <CheckIcon className="size-4" />
            </span>
            {title}
          </DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {sections.map((section) => (
            <div key={section.title} className="flex flex-col gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {section.title}
              </h4>
              <div className="flex flex-col gap-2">
                {section.rows.map((row) => (
                  <CopyableRow key={`${section.title}-${row.label}`} {...row} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter showCloseButton>
          <Button type="button" variant="outline" onClick={() => void copyAll()}>
            Copy all
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function buildPublishResultSections(args: {
  transactionDigest: string;
  transactionKind: "create_only" | "create_and_list";
  packageId: string;
  skillSlug: string;
  senderAddress: string;
  listPriceSui?: string;
  bundleWalrus: { blobId: string; objectId?: string };
  sealIdentityHex?: string;
  skillRecordId?: string;
  skillListingId?: string;
}): OnChainResultSection[] {
  const sealRows: OnChainResultRow[] = [];
  if (args.sealIdentityHex) {
    sealRows.push({
      label: "Seal identity (32-byte prefix)",
      value: args.sealIdentityHex,
    });
    sealRows.push({
      label: "Encryption",
      value: "Seal-encrypted before Walrus upload",
      mono: false,
    });
  }

  const walrusRows: OnChainResultRow[] = [
    {
      label: "Skill bundle blob ID",
      value: args.bundleWalrus.blobId,
      href: getWalrusBlobExplorerUrl(args.bundleWalrus.blobId),
    },
  ];
  if (args.bundleWalrus.objectId) {
    walrusRows.push({
      label: "Bundle Walrus object (Sui)",
      value: args.bundleWalrus.objectId,
      href: getSuiObjectExplorerUrl(args.bundleWalrus.objectId),
    });
  }
  const onChainRows: OnChainResultRow[] = [
    {
      label: "Transaction digest",
      value: args.transactionDigest,
      href: getSuiTxExplorerUrl(args.transactionDigest),
    },
    { label: "On-chain action", value: formatTransactionKind(args.transactionKind) },
    { label: "Package ID", value: args.packageId, href: getSuiObjectExplorerUrl(args.packageId) },
    { label: "Skill slug", value: args.skillSlug, mono: false },
    { label: "Publisher wallet", value: args.senderAddress, href: getSuiObjectExplorerUrl(args.senderAddress) },
  ];

  if (args.listPriceSui && args.transactionKind === "create_and_list") {
    onChainRows.push({ label: "List price", value: `${args.listPriceSui} SUI`, mono: false });
  }
  if (args.skillRecordId) {
    onChainRows.push({
      label: "SkillRecord object",
      value: args.skillRecordId,
      href: getSuiObjectExplorerUrl(args.skillRecordId),
    });
  }
  if (args.skillListingId) {
    onChainRows.push({
      label: "SkillListing object",
      value: args.skillListingId,
      href: getSuiObjectExplorerUrl(args.skillListingId),
    });
  }

  const sections: OnChainResultSection[] = [];
  if (sealRows.length > 0) sections.push({ title: "Seal encryption", rows: sealRows });
  sections.push({ title: "Walrus storage", rows: walrusRows });
  sections.push({ title: "Sui on-chain", rows: onChainRows });
  return sections;
}

function formatTransactionKind(kind: "create_only" | "create_and_list"): string {
  if (kind === "create_and_list") {
    return "Create SkillRecord + list on marketplace";
  }
  return "Create SkillRecord (not listed)";
}

export async function fetchCreatedObjectIds(
  client: SuiClient,
  digest: string,
): Promise<ReturnType<typeof parseCreatedObjectIds>> {
  const tx = await client.waitForTransaction({
    digest,
    options: { showObjectChanges: true },
  });
  return parseCreatedObjectIds(tx.objectChanges);
}

export function parseCreatedObjectIds(
  objectChanges: unknown,
): { skillRecordId?: string; skillListingId?: string; skillPurchaseId?: string } {
  if (!Array.isArray(objectChanges)) return {};

  let skillRecordId: string | undefined;
  let skillListingId: string | undefined;
  let skillPurchaseId: string | undefined;

  for (const change of objectChanges) {
    if (!change || typeof change !== "object") continue;
    const c = change as { type?: string; objectType?: string; objectId?: string };
    if (c.type !== "created" || !c.objectType || !c.objectId) continue;
    if (c.objectType.endsWith("::skill_record::SkillRecord")) {
      skillRecordId = c.objectId;
    } else if (c.objectType.endsWith("::skill_marketplace::SkillListing")) {
      skillListingId = c.objectId;
    } else if (c.objectType.endsWith("::skill_marketplace::SkillPurchase")) {
      skillPurchaseId = c.objectId;
    }
  }

  return { skillRecordId, skillListingId, skillPurchaseId };
}
