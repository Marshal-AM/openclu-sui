/**
 * Backfill Supabase skill_catalog from on-chain active listings.
 *
 * Usage (from frontend/):
 *   node scripts/backfill-catalog-from-chain.mjs
 *
 * Requires .env: NEXT_PUBLIC_OPENCLU_SKILL_PACKAGE_ID, NEXT_PUBLIC_SUI_NETWORK,
 * NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createSuiClient } from "./lib/tatum-sui-client.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(join(root, ".env"));
loadEnvFile(join(root, ".env.local"));

const packageId = process.env.NEXT_PUBLIC_OPENCLU_SKILL_PACKAGE_ID?.trim();
const network = process.env.NEXT_PUBLIC_SUI_NETWORK?.trim() || "testnet";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!packageId || !supabaseUrl || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_OPENCLU_SKILL_PACKAGE_ID, SUPABASE_URL, or SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);
const sui = createSuiClient(network);

function objectFields(item) {
  return item?.data?.content?.fields ?? null;
}

function objectId(item) {
  return String(item?.data?.objectId ?? "");
}

function decodeListing(item) {
  const fields = objectFields(item);
  if (!fields) return null;
  return {
    listingId: objectId(item),
    recordId: String(fields.record_id ?? ""),
    skillSlug: String(fields.skill_slug ?? ""),
    title: String(fields.title ?? ""),
    description: String(fields.description ?? ""),
    seller: String(fields.seller ?? ""),
    walrusBlobId: String(fields.walrus_blob_id ?? ""),
    price: String(fields.price ?? "0"),
    active: Boolean(fields.active),
    listedAtMs: String(fields.listed_at_ms ?? ""),
  };
}

async function listListingIds(limit = 100) {
  const eventType = `${packageId}::skill_marketplace::SkillListed`;
  const ids = [];
  const seen = new Set();
  let cursor = null;

  do {
    const page = await sui.queryEvents({
      query: { MoveEventType: eventType },
      limit: Math.min(limit, 50),
      cursor: cursor ?? null,
    });

    for (const item of page.data) {
      const listingId = item.parsedJson?.listing_id;
      if (!listingId || seen.has(listingId)) continue;
      seen.add(listingId);
      ids.push(listingId);
      if (ids.length >= limit) return ids;
    }

    cursor = page.nextCursor;
    if (!page.hasNextPage) break;
  } while (cursor);

  return ids;
}

async function main() {
  console.log("Fetching listing IDs from chain…");
  const ids = await listListingIds(100);
  console.log(`Found ${ids.length} listing event(s)`);

  if (ids.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  const objects = await sui.multiGetObjects({
    ids,
    options: { showContent: true },
  });

  let upserted = 0;
  for (const item of objects.data) {
    const decoded = decodeListing(item);
    if (!decoded?.active || !decoded.listingId) continue;
    const priceMist = Number(decoded.price);
    if (!Number.isFinite(priceMist) || priceMist <= 0) continue;

    const row = {
      package_id: packageId,
      network,
      listing_id: decoded.listingId,
      record_id: decoded.recordId || null,
      skill_slug: decoded.skillSlug,
      title: decoded.title,
      description: decoded.description,
      seller_address: decoded.seller.toLowerCase(),
      price_mist: priceMist,
      active: true,
      listed_at_ms: Number(decoded.listedAtMs) || Date.now(),
      walrus_blob_id: decoded.walrusBlobId || null,
      seal_encrypted: true,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("skill_catalog").upsert(row, {
      onConflict: "listing_id",
    });
    if (error) {
      console.error(`FAIL ${decoded.listingId}:`, error.message);
      continue;
    }
    upserted += 1;
    console.log(`OK ${decoded.skillSlug} (${decoded.listingId.slice(0, 10)}…)`);
  }

  console.log(`\nBackfill complete: ${upserted} row(s) upserted.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
