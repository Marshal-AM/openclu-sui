-- Semantic search for skill_catalog (run in Supabase SQL editor after skill_catalog.sql)
-- Requires pgvector extension (enabled on most Supabase projects)

create extension if not exists vector;

alter table public.skill_catalog
  add column if not exists embedding vector(384);

create index if not exists skill_catalog_embedding_hnsw_idx
  on public.skill_catalog
  using hnsw (embedding vector_cosine_ops)
  where embedding is not null and active = true;

-- Cosine similarity search: returns rows ordered by best match
create or replace function public.search_skill_catalog_semantic(
  query_embedding vector(384),
  match_count int default 1,
  min_similarity float default 0.35
)
returns table (
  id uuid,
  package_id text,
  network text,
  listing_id text,
  record_id text,
  skill_slug text,
  title text,
  description text,
  seller_address text,
  price_mist bigint,
  active boolean,
  listed_at_ms bigint,
  published_at timestamptz,
  tx_digest text,
  walrus_blob_id text,
  seal_encrypted boolean,
  updated_at timestamptz,
  similarity float
)
language sql
stable
as $$
  select
    sc.id,
    sc.package_id,
    sc.network,
    sc.listing_id,
    sc.record_id,
    sc.skill_slug,
    sc.title,
    sc.description,
    sc.seller_address,
    sc.price_mist,
    sc.active,
    sc.listed_at_ms,
    sc.published_at,
    sc.tx_digest,
    sc.walrus_blob_id,
    sc.seal_encrypted,
    sc.updated_at,
    1 - (sc.embedding <=> query_embedding) as similarity
  from public.skill_catalog sc
  where sc.active = true
    and sc.embedding is not null
    and (1 - (sc.embedding <=> query_embedding)) >= min_similarity
  order by sc.embedding <=> query_embedding
  limit greatest(1, least(match_count, 10));
$$;
