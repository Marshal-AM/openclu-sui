import type {
  SkillCatalogListResponse,
  SkillCatalogRow,
  SkillCatalogUpsertInput,
} from "@/lib/supabase/catalog-types";

export async function fetchSkillCatalog(params: {
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<SkillCatalogListResponse> {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.page) search.set("page", String(params.page));
  if (params.pageSize) search.set("pageSize", String(params.pageSize));

  const res = await fetch(`/api/skills/catalog?${search.toString()}`);
  const data = (await res.json().catch(() => ({}))) as SkillCatalogListResponse & {
    error?: string;
  };
  if (!res.ok) throw new Error(data.error ?? `Catalog fetch failed (${res.status})`);
  return data;
}

export async function fetchMySkillCatalog(seller: string): Promise<SkillCatalogRow[]> {
  const search = new URLSearchParams({ seller });
  const res = await fetch(`/api/skills/catalog/mine?${search.toString()}`);
  const data = (await res.json().catch(() => ({}))) as { items?: SkillCatalogRow[]; error?: string };
  if (!res.ok) throw new Error(data.error ?? `My skills fetch failed (${res.status})`);
  return data.items ?? [];
}

export async function upsertSkillCatalogEntry(
  body: SkillCatalogUpsertInput,
): Promise<SkillCatalogRow> {
  const res = await fetch("/api/skills/catalog/upsert", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as SkillCatalogRow & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Catalog upsert failed (${res.status})`);
  return data;
}
