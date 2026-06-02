import type { WalrusHttpRef } from "./walrus-http";
import { canonicalJson } from "./canonical-json";


export const SKILL_ENTITY_TYPES = ["skillBundle", "skillRecording"] as const;
export type SkillEntityType = (typeof SKILL_ENTITY_TYPES)[number];

export interface SkillBundlePayload {
  version: 1;
  skillSlug: string;
  title: string;
  description: string;
  skillMd: string;
  transcript: unknown;
  frameAnnotations: unknown[];
  recordedAt: string;
  expertiseSource?: string;
  triggers?: string[];
  extraTags?: string[];
}

export interface WalrusRef {
  blobId: string;
  objectId?: string;
  endEpoch?: number;
}

export interface SkillRecordInput {
  skillSlug: string;
  entityType: SkillEntityType;
  walrusBlobId: string;
  walrusObjectId: string;
  payloadHash: number[];
  sealIdentity: number[];
  title: string;
  description: string;
  attrKeys: string[];
  attrValues: string[];
  createdAtMs: bigint;
}

export function isSkillEntityType(value: string): value is SkillEntityType {
  return (SKILL_ENTITY_TYPES as readonly string[]).includes(value);
}

export function attrsToVectors(attrs: Record<string, string>): { keys: string[]; values: string[] } {
  const keys = Object.keys(attrs).sort();
  return { keys, values: keys.map((key) => attrs[key] ?? "") };
}

export async function buildSkillRecordInput(args: {
  skillSlug: string;
  entityType: SkillEntityType;
  title: string;
  description: string;
  payload: unknown;
  walrus: WalrusRef;
  sealIdentity: Uint8Array;
  attrs?: Record<string, string>;
  createdAtMs?: number;
}): Promise<SkillRecordInput> {
  if (args.sealIdentity.length !== 32) {
    throw new Error("sealIdentity must be 32 bytes");
  }
  const attrs: Record<string, string> = {
    skillSlug: args.skillSlug,
    entityType: args.entityType,
    ...args.attrs,
  };
  const vectors = attrsToVectors(attrs);
  const payloadHash = Array.from(await sha256Bytes(args.payload));

  return {
    skillSlug: args.skillSlug,
    entityType: args.entityType,
    walrusBlobId: args.walrus.blobId,
    walrusObjectId: args.walrus.objectId ?? "",
    payloadHash,
    sealIdentity: Array.from(args.sealIdentity),
    title: args.title,
    description: args.description,
    attrKeys: vectors.keys,
    attrValues: vectors.values,
    createdAtMs: BigInt(args.createdAtMs ?? Date.now()),
  };
}

export function walrusRefFromHttp(ref: WalrusHttpRef): WalrusRef {
  return {
    blobId: ref.blobId,
    objectId: ref.objectId,
    endEpoch: ref.endEpoch,
  };
}

export async function sha256Bytes(value: unknown): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  if (!globalThis.crypto?.subtle) {
    throw new Error("SHA-256 requires Web Crypto (crypto.subtle).");
  }
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
}

export function toHex(bytes: Uint8Array | number[]): string {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

