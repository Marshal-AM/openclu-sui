import { embedText } from "@/lib/embeddings/skill-embedder";
import { getSupabaseServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import {
  rowToCatalogCard,
  type SkillCatalogCard,
  type SkillCatalogRow,
} from "@/lib/supabase/catalog-types";

export type SkillCatalogSearchResult = SkillCatalogCard & {
  similarity: number;
};

type SemanticSearchRow = SkillCatalogRow & {
  similarity: number;
};

export async function searchSkillCatalogSemantic(
  query: string,
  opts?: { limit?: number; minSimilarity?: number },
): Promise<SkillCatalogSearchResult[]> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured.");
  }

  const trimmed = query.trim();
  if (!trimmed) return [];

  const limit = opts?.limit ?? 1;
  const minSimilarity = opts?.minSimilarity ?? 0.35;
  const embedding = await embedText(trimmed);

  const client = getSupabaseServiceClient();
  const { data, error } = await client.rpc("search_skill_catalog_semantic", {
    query_embedding: embedding,
    match_count: limit,
    min_similarity: minSimilarity,
  });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as SemanticSearchRow[];
  return rows.map((row) => ({
    ...rowToCatalogCard(row),
    similarity: row.similarity ?? 0,
  }));
}

export async function listCatalogRowsMissingEmbeddings(limit = 50): Promise<SkillCatalogRow[]> {
  const client = getSupabaseServiceClient();
  const { data, error } = await client
    .from("skill_catalog")
    .select("*")
    .is("embedding", null)
    .eq("active", true)
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as SkillCatalogRow[];
}

export async function updateCatalogEmbedding(
  listingId: string,
  embedding: number[],
): Promise<void> {
  const client = getSupabaseServiceClient();
  const { error } = await client
    .from("skill_catalog")
    .update({ embedding, updated_at: new Date().toISOString() })
    .eq("listing_id", listingId);

  if (error) throw new Error(error.message);
}
