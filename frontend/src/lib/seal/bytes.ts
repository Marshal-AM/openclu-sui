/**
 * Copy into a standalone ArrayBuffer-backed Uint8Array.
 * Seal / @mysten/bcs use `new DataView(buf.buffer, offset, length)` which throws when
 * `buf.buffer` is not an ArrayBuffer (e.g. Sui RPC subarrays, SharedArrayBuffer).
 */
export function ensureUint8Array(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(bytes);
}
