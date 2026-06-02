-- Metadata index only — NO skill content / ciphertext
-- Run in Supabase SQL editor

create table if not exists public.skill_catalog (
  id uuid primary key default gen_random_uuid(),

  package_id text not null,
  network text not null default 'testnet',

  listing_id text not null unique,
  record_id text,
  skill_slug text not null,
  title text not null,
  description text not null,

  seller_address text not null,
  price_mist bigint not null check (price_mist > 0),

  active boolean not null default true,
  listed_at_ms bigint,
  published_at timestamptz not null default now(),
  tx_digest text,
  walrus_blob_id text,
  seal_encrypted boolean not null default true,

  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(skill_slug, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) stored,

  updated_at timestamptz not null default now()
);

create index if not exists skill_catalog_seller_idx
  on public.skill_catalog (lower(seller_address));

create index if not exists skill_catalog_active_idx
  on public.skill_catalog (active, published_at desc)
  where active;

create index if not exists skill_catalog_search_idx
  on public.skill_catalog using gin (search_vector);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists skill_catalog_updated_at on public.skill_catalog;
create trigger skill_catalog_updated_at
  before update on public.skill_catalog
  for each row execute function public.set_updated_at();

alter table public.skill_catalog enable row level security;

drop policy if exists skill_catalog_public_read on public.skill_catalog;
create policy skill_catalog_public_read
  on public.skill_catalog for select
  using (true);
