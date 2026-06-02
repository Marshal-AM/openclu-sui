import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SkillCatalogRow } from "@/lib/supabase/catalog-types";

let serviceClient: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
}

export function getSupabaseServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  if (!serviceClient) {
    serviceClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return serviceClient;
}

export type CatalogListParams = {
  q?: string;
  page?: number;
  pageSize?: number;
  seller?: string;
  activeOnly?: boolean;
};

export async function listSkillCatalog(
  params: CatalogListParams,
): Promise<{ items: SkillCatalogRow[]; total: number }> {
  const client = getSupabaseServiceClient();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, params.pageSize ?? 12));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = client
    .from("skill_catalog")
    .select("*", { count: "exact" })
    .order("published_at", { ascending: false });

  if (params.activeOnly !== false) {
    query = query.eq("active", true);
  }

  if (params.seller?.trim()) {
    query = query.eq("seller_address", params.seller.trim().toLowerCase());
  }

  const q = params.q?.trim();
  if (q) {
    const safe = q.replace(/[%_,]/g, " ").trim();
    const pattern = `%${safe}%`;
    query = query.or(
      `title.ilike.${pattern},skill_slug.ilike.${pattern},description.ilike.${pattern}`,
    );
  }

  const { data, error, count } = await query.range(from, to);
  if (error) throw new Error(error.message);

  return {
    items: (data ?? []) as SkillCatalogRow[],
    total: count ?? 0,
  };
}

export async function upsertSkillCatalogRow(
  input: import("@/lib/supabase/catalog-types").SkillCatalogUpsertInput,
): Promise<SkillCatalogRow> {
  const client = getSupabaseServiceClient();
  const priceMist =
    typeof input.priceMist === "bigint"
      ? Number(input.priceMist)
      : typeof input.priceMist === "string"
        ? Number(input.priceMist)
        : input.priceMist;

  if (!Number.isFinite(priceMist) || priceMist <= 0) {
    throw new Error("priceMist must be a positive number");
  }

  const row = {
    package_id: input.packageId,
    network: input.network,
    listing_id: input.listingId,
    record_id: input.recordId ?? null,
    skill_slug: input.skillSlug,
    title: input.title,
    description: input.description,
    seller_address: input.sellerAddress.toLowerCase(),
    price_mist: priceMist,
    active: true,
    listed_at_ms:
      input.listedAtMs != null && input.listedAtMs !== ""
        ? Number(input.listedAtMs)
        : Date.now(),
    tx_digest: input.txDigest ?? null,
    walrus_blob_id: input.walrusBlobId ?? null,
    seal_encrypted: input.sealEncrypted ?? true,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await client
    .from("skill_catalog")
    .upsert(row, { onConflict: "listing_id" })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as SkillCatalogRow;
}
