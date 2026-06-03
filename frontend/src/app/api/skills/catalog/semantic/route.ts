import { searchSkillCatalogSemantic } from "@/lib/supabase/skill-search";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return Response.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    if (!q) {
      return Response.json({ error: "Missing q parameter." }, { status: 400 });
    }

    const limit = Number(url.searchParams.get("limit") ?? "1");
    const minSimilarity = Number(url.searchParams.get("minSimilarity") ?? "0.35");

    const items = await searchSkillCatalogSemantic(q, {
      limit: Number.isFinite(limit) ? limit : 1,
      minSimilarity: Number.isFinite(minSimilarity) ? minSimilarity : 0.35,
    });

    return Response.json({ items });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Semantic search failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
