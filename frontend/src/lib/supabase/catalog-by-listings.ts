import { getSupabaseServiceClient } from "@/lib/supabase/server";
import type { SkillCatalogRow } from "@/lib/supabase/catalog-types";

export async function getCatalogByListingIds(
  listingIds: string[],
): Promise<Map<string, SkillCatalogRow>> {
  const map = new Map<string, SkillCatalogRow>();
  if (listingIds.length === 0) return map;

  const client = getSupabaseServiceClient();
  const { data, error } = await client
    .from("skill_catalog")
    .select("*")
    .in("listing_id", listingIds);

  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as SkillCatalogRow[]) {
    map.set(row.listing_id, row);
  }
  return map;
}
