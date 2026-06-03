"use client";

import {
  useCurrentAccount,
  useCurrentWallet,
  useSuiClient,
  useSuiClientContext,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  buildPublishResultSections,
  OnChainResultModal,
  fetchCreatedObjectIds,
  type OnChainResultSection,
} from "@/components/skills/on-chain-result-modal";
import { getSuiObjectExplorerUrl, getSuiTxExplorerUrl } from "@/lib/sui/explorers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildPurchaseSkillTx } from "@/lib/sui/move-tx";
import {
  extractTransactionDigestFromError,
  assertWalletBalanceForPurchase,
  assertWalletGasBalance,
  formatWalletSignError,
  signAndExecuteTransactionWithWallet,
} from "@/lib/sui/sign-and-execute";
import {
  getOpencluSkillPackageId,
  getSuiNetwork,
  suiToMist,
  tryGetOpencluSkillPackageId,
} from "@/lib/sui/config";
import type { SkillBundlePayload } from "@/lib/sui/entities";
import { generateSealIdentityPrefix, sealIdentityPrefixToHex } from "@/lib/seal/identity";
import { PublishFlowLogPanel } from "@/components/skills/publish-flow-log";
import { encryptSkillPayload } from "@/lib/seal/encrypt-skill";
import { createPublishFlowLogger } from "@/lib/publish-flow-log";
import {
  bytesToBase64,
  preparePublishSkillOnChain,
  transactionFromBase64,
  type PublishPrepareRequest,
} from "@/lib/sui/publish-skill-client";
import { upsertSkillCatalogEntry } from "@/lib/supabase/catalog-client";
import { createPublishSuiClient, publishFlowDelay } from "@/lib/sui/publish-rpc";
import type { FrameAnnotation, Transcript } from "@/lib/skill-md";

type PublishSkillPanelProps = {
  skillSlug: string;
  title: string;
  description: string;
  skillMd: string;
  transcript: Transcript;
  frameAnnotations: FrameAnnotation[];
  recordedAt: string;
  expertiseSource?: string;
  triggers?: string[];
  extraTags?: string[];
};

export function PublishSkillPanel(props: PublishSkillPanelProps) {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { currentWallet, supportedIntents, isConnected } = useCurrentWallet();
  const { network } = useSuiClientContext();
  const [listPriceSui, setListPriceSui] = useState("0.1");
  const [publishing, setPublishing] = useState(false);
  const [flowLog, setFlowLog] = useState(createPublishFlowLogger);
  const [logTick, setLogTick] = useState(0);
  const [resultOpen, setResultOpen] = useState(false);
  const [resultSections, setResultSections] = useState<OnChainResultSection[]>([]);

  useEffect(() => {
    return flowLog.subscribe(() => setLogTick((n) => n + 1));
  }, [flowLog]);

  const publish = useCallback(async () => {
    const address = account?.address;
    if (!address) {
      toast.error("Connect your Sui wallet first.");
      return;
    }

    const priceTrimmed = listPriceSui.trim();
    if (!priceTrimmed || suiToMist(priceTrimmed) <= BigInt(0)) {
      toast.error("Enter a list price greater than 0 SUI.");
      return;
    }

    setPublishing(true);
    const logger = createPublishFlowLogger();
    setFlowLog(logger);
    try {
      const packageId = getOpencluSkillPackageId();
      logger.log("sui", "Publish started", {
        detail: `package=${packageId} wallet=${address}`,
      });

      const sealIdentityPrefix = generateSealIdentityPrefix();
      logger.log("seal", "Generated seal identity prefix", {
        detail: sealIdentityPrefixToHex(sealIdentityPrefix),
      });

      const bundlePayload: SkillBundlePayload = {
        version: 1,
        skillSlug: props.skillSlug,
        title: props.title,
        description: props.description,
        skillMd: props.skillMd,
        transcript: props.transcript,
        frameAnnotations: props.frameAnnotations,
        recordedAt: props.recordedAt,
        expertiseSource: props.expertiseSource,
        triggers: props.triggers,
        extraTags: props.extraTags,
      };

      await publishFlowDelay(logger, "before Seal encryption");
      const publishRpcClient = createPublishSuiClient();
      const encrypted = await encryptSkillPayload(
        publishRpcClient,
        sealIdentityPrefix,
        bundlePayload,
        logger,
      );

      await publishFlowDelay(logger, "before Walrus upload and transaction build");

      logger.log("walrus", "Uploading Seal-encrypted skill bundle to Walrus", {
        detail: `${encrypted.encryptedBundle.length} bytes`,
      });

      const body: PublishPrepareRequest = {
        ownerAddress: address,
        skillSlug: props.skillSlug,
        title: props.title,
        description: props.description,
        skillMd: props.skillMd,
        transcript: props.transcript,
        frameAnnotations: props.frameAnnotations,
        recordedAt: props.recordedAt,
        expertiseSource: props.expertiseSource,
        triggers: props.triggers,
        extraTags: props.extraTags,
        sealIdentityPrefixHex: sealIdentityPrefixToHex(sealIdentityPrefix),
        encryptedBundleBase64: bytesToBase64(encrypted.encryptedBundle),
        listPriceSui: priceTrimmed,
      };

      const prepared = await preparePublishSkillOnChain(body);

      logger.log("walrus", "Walrus upload complete", {
        level: "success",
        detail: `bundle blobId=${prepared.bundleWalrus.blobId}`,
      });
      logger.log("sui", "On-chain transaction prepared", {
        detail: `kind=${prepared.transactionKind} seal_identity=${prepared.sealIdentityHex}`,
      });

      const txBytes = transactionFromBase64(prepared.transactionBytes);
      let transaction: Transaction;
      try {
        transaction = Transaction.from(txBytes);
      } catch (txErr) {
        const detail = txErr instanceof Error ? txErr.message : String(txErr);
        throw new Error(`Could not load prepared Sui transaction: ${detail}`);
      }

      await publishFlowDelay(logger, "before wallet signing");

      if (!currentWallet || !isConnected || !account) {
        throw new Error("Connect your Sui wallet first.");
      }

      const appNetwork = getSuiNetwork();
      if (network !== appNetwork) {
        throw new Error(
          `App network mismatch: UI is on ${network} but NEXT_PUBLIC_SUI_NETWORK=${appNetwork}. ` +
            "Restart dev server after changing .env and reconnect the wallet.",
        );
      }

      const { totalMist } = await assertWalletGasBalance(client, address);
      logger.log("wallet", "Pre-sign checks passed", {
        detail: `network=${network} balance=${(Number(totalMist) / 1e9).toFixed(4)} SUI chain=sui:${network}`,
      });

      logger.log("wallet", "Requesting wallet signature…", {
        detail: `wallet=${currentWallet.name} account=${address.slice(0, 10)}…`,
      });

      let digest: string;
      try {
        const executed = await signAndExecuteTransactionWithWallet({
          wallet: currentWallet,
          account,
          client,
          network,
          supportedIntents,
          transaction,
        });
        digest = executed.digest;
        logger.log("wallet", "Signed and executed", {
          level: "success",
          detail: `method=${executed.method} digest=${digest}`,
        });
      } catch (signErr) {
        const recovered = formatWalletSignError(signErr, { network });
        const digestFromErr =
          signErr instanceof Error
            ? extractTransactionDigestFromError(signErr.message)
            : null;
        if (digestFromErr) {
          logger.log("wallet", "Transaction may have succeeded despite error", {
            detail: `digest=${digestFromErr}`,
          });
          digest = digestFromErr;
        } else {
          throw new Error(recovered);
        }
      }

      const created = await fetchCreatedObjectIds(client, digest);

      if (!created.skillListingId) {
        throw new Error("Listing was not created on-chain. Cannot index marketplace catalog.");
      }

      try {
        const priceMist = suiToMist(priceTrimmed);
        await upsertSkillCatalogEntry({
          packageId,
          network: getSuiNetwork(),
          listingId: created.skillListingId,
          recordId: created.skillRecordId ?? null,
          skillSlug: props.skillSlug,
          title: props.title,
          description: props.description,
          sellerAddress: address,
          priceMist: priceMist.toString(),
          walrusBlobId: prepared.bundleWalrus.blobId,
          txDigest: digest,
          listedAtMs: Date.now(),
          sealEncrypted: true,
        });
        logger.log("sui", "Marketplace catalog indexed", {
          level: "success",
          detail: `listing=${created.skillListingId}`,
        });
      } catch (catalogErr) {
        const detail = catalogErr instanceof Error ? catalogErr.message : String(catalogErr);
        logger.log("sui", "Catalog index failed (on-chain publish succeeded)", {
          level: "error",
          detail,
        });
        toast.warning("Published on-chain, but catalog index failed", { description: detail });
      }

      logger.log("sui", "Transaction executed on-chain", {
        level: "success",
        detail: `digest=${digest}${
          created.skillRecordId ? ` record=${created.skillRecordId}` : ""
        }${created.skillListingId ? ` listing=${created.skillListingId}` : ""}`,
      });

      setResultSections(
        buildPublishResultSections({
          transactionDigest: digest,
          transactionKind: prepared.transactionKind,
          packageId,
          skillSlug: props.skillSlug,
          senderAddress: address,
          listPriceSui: listPriceSui.trim() || undefined,
          sealIdentityHex: prepared.sealIdentityHex,
          bundleWalrus: prepared.bundleWalrus,
          skillRecordId: created.skillRecordId,
          skillListingId: created.skillListingId,
        }),
      );
      setResultOpen(true);
    } catch (err) {
      let message = formatWalletSignError(err, { network: getSuiNetwork() });
      if (/429|too many requests/i.test(message)) {
        message =
          "Tatum RPC rate limit (429). Publish now waits between steps; try again in a minute or set NEXT_PUBLIC_PUBLISH_RPC_GAP_MS=8000 in .env.";
      }
      const phase =
        /seal|encrypt|key server|typed array|DataView|BCS/i.test(message) ? "seal" : "sui";
      logger.log(phase, "Publish failed", { level: "error", detail: message });
      toast.error("Publish failed", { description: message });
    } finally {
      setPublishing(false);
    }
  }, [account, client, currentWallet, isConnected, listPriceSui, network, props, supportedIntents]);

  if (!tryGetOpencluSkillPackageId()) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-950 dark:text-amber-100">
        Deploy <code className="text-xs">contracts/openclu_skill</code> and set{" "}
        <code className="text-xs">NEXT_PUBLIC_OPENCLU_SKILL_PACKAGE_ID</code> to enable on-chain publish.
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        <div>
          <h3 className="text-sm font-medium">Publish to Walrus + Sui (Seal encrypted)</h3>
          <p className="text-xs text-muted-foreground">
            Encrypts the skill bundle (SKILL.md, transcript, frame notes) with Seal, stores it on Walrus,
            and registers on-chain. Screen recordings are not uploaded to Walrus.
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="list-price-sui">List price (SUI, required)</Label>
          <Input
            id="list-price-sui"
            type="text"
            inputMode="decimal"
            placeholder="0.1"
            value={listPriceSui}
            onChange={(e) => setListPriceSui(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Every publish is listed on the marketplace at this price.
          </p>
        </div>
        <Button type="button" disabled={publishing || !account} onClick={() => void publish()}>
          {publishing ? "Encrypting & publishing…" : "Publish skill on-chain"}
        </Button>
        {publishing || flowLog.entries().length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Publish log</p>
            <PublishFlowLogPanel key={logTick} entries={flowLog.entries()} />
          </div>
        ) : null}
      </div>

      <OnChainResultModal
        open={resultOpen}
        onOpenChange={setResultOpen}
        title="Published successfully"
        description="Use these identifiers to verify Seal encryption, Walrus storage, and the Sui transaction."
        sections={resultSections}
      />
    </>
  );
}

export function PurchaseSkillButton({
  listingId,
  priceMist,
  skillSlug,
  onPurchased,
}: {
  listingId: string;
  priceMist: bigint;
  skillSlug?: string;
  onPurchased?: (purchaseId: string) => void;
}) {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { currentWallet, supportedIntents, isConnected } = useCurrentWallet();
  const { network } = useSuiClientContext();
  const [buying, setBuying] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [resultSections, setResultSections] = useState<OnChainResultSection[]>([]);

  const finishPurchase = async (digest: string) => {
    const created = await fetchCreatedObjectIds(client, digest);

    if (created.skillPurchaseId) {
      onPurchased?.(created.skillPurchaseId);
    }

    setResultSections([
      {
        title: "Sui on-chain",
        rows: [
          {
            label: "Transaction digest",
            value: digest,
            href: getSuiTxExplorerUrl(digest),
          },
          { label: "On-chain action", value: "Purchase skill (SkillPurchase receipt)", mono: false },
          {
            label: "Listing ID",
            value: listingId,
            href: getSuiObjectExplorerUrl(listingId),
          },
          ...(created.skillPurchaseId
            ? [
                {
                  label: "SkillPurchase object",
                  value: created.skillPurchaseId,
                  href: getSuiObjectExplorerUrl(created.skillPurchaseId),
                },
              ]
            : []),
          ...(skillSlug ? [{ label: "Skill slug", value: skillSlug, mono: false }] : []),
          ...(account?.address
            ? [
                {
                  label: "Buyer wallet",
                  value: account.address,
                  href: getSuiObjectExplorerUrl(account.address),
                },
              ]
            : []),
        ],
      },
    ]);
    setResultOpen(true);
    toast.success("Purchase complete", { description: "You can decrypt and view the skill now." });
  };

  const buy = async () => {
    if (!account?.address) {
      toast.error("Connect your Sui wallet first.");
      return;
    }
    if (!currentWallet || !isConnected) {
      toast.error("Connect your Sui wallet first.");
      return;
    }

    setBuying(true);
    const appNetwork = getSuiNetwork();
    try {
      if (network !== appNetwork) {
        throw new Error(
          `App network mismatch: UI is on ${network} but NEXT_PUBLIC_SUI_NETWORK=${appNetwork}. ` +
            "Restart dev server after changing .env and reconnect the wallet.",
        );
      }

      const { totalMist } = await assertWalletBalanceForPurchase(
        client,
        account.address,
        priceMist,
      );
      console.info(
        `[purchase] pre-sign ok network=${appNetwork} balance=${(Number(totalMist) / 1e9).toFixed(4)} SUI price=${(Number(priceMist) / 1e9).toFixed(4)} SUI wallet=${currentWallet.name}`,
      );

      const packageId = getOpencluSkillPackageId();
      const tx = buildPurchaseSkillTx({ packageId, listingId, priceMist });
      tx.setSenderIfNotSet(account.address);

      let digest: string;
      try {
        const executed = await signAndExecuteTransactionWithWallet({
          wallet: currentWallet,
          account,
          client,
          network: appNetwork,
          supportedIntents,
          transaction: tx,
        });
        digest = executed.digest;
        console.info(`[purchase] signed digest=${digest} method=${executed.method}`);
      } catch (signErr) {
        const recovered = formatWalletSignError(signErr, { network: appNetwork });
        const digestFromErr =
          signErr instanceof Error
            ? extractTransactionDigestFromError(signErr.message)
            : null;
        if (digestFromErr) {
          console.warn(`[purchase] wallet error but digest found: ${digestFromErr}`);
          digest = digestFromErr;
        } else {
          throw new Error(recovered);
        }
      }

      await finishPurchase(digest);
    } catch (err) {
      let message = formatWalletSignError(err, { network: appNetwork });
      const digestFromError =
        err instanceof Error ? extractTransactionDigestFromError(err.message) : null;
      if (digestFromError) {
        try {
          await finishPurchase(digestFromError);
          return;
        } catch {
          // On-chain tx may exist but post-processing still failed.
        }
      }
      toast.error("Purchase failed", { description: message });
    } finally {
      setBuying(false);
    }
  };

  return (
    <>
      <Button type="button" size="sm" disabled={buying} onClick={() => void buy()}>
        {buying ? "Buying…" : "Buy skill"}
      </Button>
      <OnChainResultModal
        open={resultOpen}
        onOpenChange={setResultOpen}
        title="Purchase confirmed"
        description="Verify the transaction and your purchase receipt on Sui Scan."
        sections={resultSections}
      />
    </>
  );
}
