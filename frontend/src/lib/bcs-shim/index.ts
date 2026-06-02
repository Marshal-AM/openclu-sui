/**
 * Re-export @mysten/bcs with a safe BcsReader.
 * Client bundles: next.config webpack alias + patched-reader.mjs replacement.
 */
export { BcsReader } from "./reader";
export * from "@mysten/bcs";
