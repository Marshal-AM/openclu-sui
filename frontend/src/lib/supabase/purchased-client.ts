import type { PurchasedSkillEntry } from "@/app/api/skills/purchased/route";

export async function fetchPurchasedSkills(buyerAddress: string): Promise<PurchasedSkillEntry[]> {
  const res = await fetch("/api/skills/purchased", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ buyerAddress }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    items?: PurchasedSkillEntry[];
    error?: string;
  };
  if (!res.ok) throw new Error(data.error ?? `Purchased skills fetch failed (${res.status})`);
  return data.items ?? [];
}
