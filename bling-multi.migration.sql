-- Aplicar no Supabase SQL Editor. Não altera tabelas pré-existentes.
create extension if not exists pgcrypto;
create table if not exists public.bling_connections (
 id uuid primary key default gen_random_uuid(), portal_user_id uuid not null references public.portal_users(id) on delete cascade,
 name text not null, company_id text, webhook_company_id text, status text not null default 'connected' check (status in ('connected','disconnected','error')),
 access_token_enc text, refresh_token_enc text, expires_at timestamptz, last_sync_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(portal_user_id,company_id)
);
create index if not exists bling_connections_company_lookup on public.bling_connections(company_id,status);
create table if not exists public.bling_oauth_states (
 state_hash text primary key, portal_user_id uuid not null references public.portal_users(id) on delete cascade,
 connection_id uuid references public.bling_connections(id) on delete cascade, expires_at timestamptz not null
);
create table if not exists public.bling_stock_entries (
 id uuid primary key default gen_random_uuid(), bling_connection_id uuid not null references public.bling_connections(id) on delete cascade,
 event_id text not null, product_id text not null, sku text, product_name text, image_url text,
 quantity numeric(14,3) not null check(quantity>0), occurred_at timestamptz not null,
 payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
 unique(bling_connection_id,event_id)
);
create index if not exists bling_stock_entries_recent on public.bling_stock_entries(bling_connection_id,occurred_at desc);
create table if not exists public.bling_label_templates (
 id uuid primary key default gen_random_uuid(), portal_user_id uuid not null references public.portal_users(id) on delete cascade,
 name text not null, width_mm numeric(7,2) not null, height_mm numeric(7,2) not null,
 elements jsonb not null default '[]'::jsonb, is_default boolean not null default false,
 created_at timestamptz not null default now()
);
create unique index if not exists bling_one_default_template on public.bling_label_templates(portal_user_id) where is_default;
create index if not exists bling_label_templates_owner on public.bling_label_templates(portal_user_id);
-- Apenas o backend com service role pode operar estas tabelas.
alter table public.bling_connections enable row level security;
alter table public.bling_oauth_states enable row level security;
alter table public.bling_stock_entries enable row level security;
alter table public.bling_label_templates enable row level security;
revoke all on public.bling_connections, public.bling_oauth_states, public.bling_stock_entries, public.bling_label_templates from anon, authenticated;
