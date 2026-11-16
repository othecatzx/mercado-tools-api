-- Execute no SQL Editor do Supabase ANTES de publicar o backend.
create table if not exists public.portal_admin_passwords (
  portal_user_id uuid primary key references public.portal_users(id) on delete cascade,
  password_hash text not null,
  updated_at timestamptz not null default now()
);
alter table public.portal_admin_passwords enable row level security;
-- Apenas a API, com service_role, acessa esta tabela. Nenhuma policy pública.
revoke all on public.portal_admin_passwords from anon, authenticated;
