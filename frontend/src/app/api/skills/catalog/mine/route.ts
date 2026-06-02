import { isSupabaseConfigured, listSkillCatalog } from "@/lib/supabase/server";

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return Response.json(
      { error: "Supabase is not configured on the server." },
      { status: 503 },
    );
  }

  try {
    const url = new URL(request.url);
    const seller = url.searchParams.get("seller")?.trim();
    if (!seller) {
      return Response.json({ error: "Missing seller query parameter." }, { status: 400 });
    }

    const { items } = await listSkillCatalog({
      seller,
      page: 1,
      pageSize: 100,
      activeOnly: false,
    });

    return Response.json({ items });
  } catch (err) {
    const message = err instanceof Error ? err.message : "My skills list failed.";
    console.error("[catalog/mine GET]", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
