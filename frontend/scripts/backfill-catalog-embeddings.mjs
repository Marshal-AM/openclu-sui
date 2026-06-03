/**
 * Backfill skill_catalog.embedding for rows missing vectors.
 *
 * Usage (from frontend/):
 *   node scripts/backfill-catalog-embeddings.mjs
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Run supabase/skill_catalog_embeddings.sql first.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { pipeline, env } from "@xenova/transformers";

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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!supabaseUrl || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

env.cacheDir = join(root, ".cache", "transformers");
env.allowLocalModels = true;

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: ws },
});

function buildListingEmbedText(title, skillSlug, description) {
  return `${title.trim()}\n${skillSlug.trim()}\n${description.trim()}`;
}

async function embedText(pipe, text) {
  const output = await pipe(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

async function main() {
  console.log("Loading embedding model…");
  const pipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
    quantized: true,
  });

  let total = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("skill_catalog")
      .select("listing_id, title, skill_slug, description")
      .is("embedding", null)
      .eq("active", true)
      .limit(20);

    if (error) {
      console.error(error.message);
      process.exit(1);
    }

    if (!data?.length) break;

    for (const row of data) {
      const text = buildListingEmbedText(row.title, row.skill_slug, row.description);
      const embedding = await embedText(pipe, text);
      const { error: updateError } = await supabase
        .from("skill_catalog")
        .update({ embedding, updated_at: new Date().toISOString() })
        .eq("listing_id", row.listing_id);

      if (updateError) {
        console.error(`Failed ${row.listing_id}:`, updateError.message);
        continue;
      }
      total += 1;
      console.log(`Embedded: ${row.title} (${row.listing_id})`);
    }
  }

  console.log(`Done. Embedded ${total} listing(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
