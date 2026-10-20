-- Execute no SQL Editor do Supabase do projeto usado pelo mercado-tools-api.
-- Tabelas do portal do cliente; não altera as tabelas existentes de licenças/dispositivos.
create extension if not exists pgcrypto;

create table if not exists public.portal_users (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  email text not null unique,
  senha_hash text not null,
  status text not null default 'active' check (status in ('active','blocked')),
  created_at timestamptz not null default now()
);

create table if not exists public.portal_user_licenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.portal_users(id) on delete cascade,
  license_id uuid not null unique references public.licenses(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint portal_user_licenses_user_license_unique unique (user_id, license_id)
);

create index if not exists portal_user_licenses_user_id_idx on public.portal_user_licenses(user_id);
create index if not exists portal_user_licenses_license_id_idx on public.portal_user_licenses(license_id);

alter table public.portal_users enable row level security;
alter table public.portal_user_licenses enable row level security;
-- O backend acessa essas tabelas com SUPABASE_SERVICE_KEY; não crie políticas públicas.
