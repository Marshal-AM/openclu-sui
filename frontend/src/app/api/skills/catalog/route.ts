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
    const q = url.searchParams.get("q") ?? undefined;
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("pageSize") ?? "12");

    const { items, total } = await listSkillCatalog({
      q,
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 12,
      activeOnly: true,
    });

    return Response.json({
      items,
      total,
      page: Number.isFinite(page) ? Math.max(1, page) : 1,
      pageSize: Number.isFinite(pageSize) ? Math.min(50, Math.max(1, pageSize)) : 12,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Catalog list failed.";
    console.error("[catalog GET]", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
