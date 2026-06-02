import type { SkillCatalogUpsertInput } from "@/lib/supabase/catalog-types";
import { isSupabaseConfigured, upsertSkillCatalogRow } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return Response.json(
      { error: "Supabase is not configured on the server." },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json()) as SkillCatalogUpsertInput;

    if (
      !body.listingId?.trim() ||
      !body.skillSlug?.trim() ||
      !body.title?.trim() ||
      !body.description?.trim() ||
      !body.sellerAddress?.trim() ||
      !body.packageId?.trim()
    ) {
      return Response.json(
        { error: "Missing required catalog fields (listingId, slug, title, seller, packageId)." },
        { status: 400 },
      );
    }

    const row = await upsertSkillCatalogRow(body);
    return Response.json(row);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Catalog upsert failed.";
    console.error("[catalog/upsert POST]", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
