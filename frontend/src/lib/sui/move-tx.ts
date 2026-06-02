import { Transaction } from "@mysten/sui/transactions";
import type { SkillRecordInput } from "./entities";

export function skillRecordTarget(
  packageId: string,
  functionName: string,
): `${string}::skill_record::${string}` {
  return `${packageId}::skill_record::${functionName}`;
}

export function skillMarketplaceTarget(
  packageId: string,
  functionName: string,
): `${string}::skill_marketplace::${string}` {
  return `${packageId}::skill_marketplace::${functionName}`;
}

export function buildCreateSkillRecordTx(
  packageId: string,
  record: SkillRecordInput,
): Transaction {
  const tx = new Transaction();
  addCreateSkillRecordCall(tx, packageId, record);
  return tx;
}

export function addCreateSkillRecordCall(
  tx: Transaction,
  packageId: string,
  record: SkillRecordInput,
): void {
  tx.moveCall({
    target: skillRecordTarget(packageId, "create_skill_record"),
    arguments: [
      tx.pure.string(record.skillSlug),
      tx.pure.string(record.entityType),
      tx.pure.string(record.walrusBlobId),
      tx.pure.string(record.walrusObjectId),
      tx.pure.vector("u8", record.payloadHash),
      tx.pure.vector("u8", record.sealIdentity),
      tx.pure.string(record.title),
      tx.pure.string(record.description),
      tx.pure.vector("string", record.attrKeys),
      tx.pure.vector("string", record.attrValues),
      tx.pure.u64(record.createdAtMs),
    ],
  });
}

export interface ListSkillArgs {
  packageId: string;
  recordId: string;
  priceMist: bigint;
}

export function buildListSkillTx(args: ListSkillArgs): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: skillMarketplaceTarget(args.packageId, "list_skill"),
    arguments: [
      tx.object(args.recordId),
      tx.pure.u64(args.priceMist),
      tx.object.clock(),
    ],
  });
  return tx;
}

export interface PurchaseSkillArgs {
  packageId: string;
  listingId: string;
  priceMist: bigint;
}

export function buildPurchaseSkillTx(args: PurchaseSkillArgs): Transaction {
  const tx = new Transaction();
  const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(args.priceMist)]);
  tx.moveCall({
    target: skillMarketplaceTarget(args.packageId, "purchase_skill"),
    arguments: [tx.object(args.listingId), payment, tx.object.clock()],
  });
  return tx;
}

export function skillAccessTarget(packageId: string, functionName: string): `${string}::skill_access::${string}` {
  return `${packageId}::skill_access::${functionName}`;
}

export function buildCreateRecordAndListTx(
  packageId: string,
  record: SkillRecordInput,
  priceMist: bigint,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: skillMarketplaceTarget(packageId, "create_record_and_list"),
    arguments: [
      tx.pure.string(record.skillSlug),
      tx.pure.string(record.entityType),
      tx.pure.string(record.walrusBlobId),
      tx.pure.string(record.walrusObjectId),
      tx.pure.vector("u8", record.payloadHash),
      tx.pure.vector("u8", record.sealIdentity),
      tx.pure.string(record.title),
      tx.pure.string(record.description),
      tx.pure.vector("string", record.attrKeys),
      tx.pure.vector("string", record.attrValues),
      tx.pure.u64(record.createdAtMs),
      tx.pure.u64(priceMist),
      tx.object.clock(),
    ],
  });
  return tx;
}
