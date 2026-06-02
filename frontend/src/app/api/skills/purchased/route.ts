import { SuiClient } from "@mysten/sui/client";
import { getOpencluSkillPackageId, getSuiRpcUrl } from "@/lib/sui/config";
import { listSkillPurchasesByOwner, type DecodedSkillPurchase } from "@/lib/sui/queries";
import { getCatalogByListingIds } from "@/lib/supabase/catalog-by-listings";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { rowToCatalogCard, type SkillCatalogCard } from "@/lib/supabase/catalog-types";

export type PurchasedSkillEntry = {
  purchase: DecodedSkillPurchase;
  catalog: SkillCatalogCard | null;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { buyerAddress?: string };
    const buyerAddress = body.buyerAddress?.trim();
    if (!buyerAddress) {
      return Response.json({ error: "Missing buyerAddress." }, { status: 400 });
    }

    const packageId = getOpencluSkillPackageId();
    const client = new SuiClient({ url: getSuiRpcUrl() });
    const purchases = await listSkillPurchasesByOwner(client, packageId, buyerAddress, 100);

    const catalogMap = new Map<string, SkillCatalogCard>();
    if (isSupabaseConfigured() && purchases.length > 0) {
      const listingIds = [...new Set(purchases.map((p) => p.listingId))];
      const rows = await getCatalogByListingIds(listingIds);
      for (const [id, row] of rows) {
        catalogMap.set(id, rowToCatalogCard(row));
      }
    }

    const items: PurchasedSkillEntry[] = purchases.map((purchase) => ({
      purchase,
      catalog: catalogMap.get(purchase.listingId) ?? null,
    }));

    return Response.json({ items });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load purchases.";
    console.error("[purchased POST]", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
