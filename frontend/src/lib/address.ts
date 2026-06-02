/** Shorten a blockchain address for display (e.g. `0x1234…abcd`). */
export function shortAddress(address: string, visible = 4): string {
  if (address.length <= visible * 2 + 3) return address;
  const prefix = address.startsWith("0x") ? visible + 2 : visible;
  return `${address.slice(0, prefix)}…${address.slice(-visible)}`;
}
