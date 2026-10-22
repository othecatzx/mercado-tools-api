-- ML SH Support: primeira etapa do módulo de atendimento.
-- Execute no SQL Editor do projeto Supabase antes de publicar a API.

create table if not exists public.support_agents (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 100),
  email text not null,
  senha_hash text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  permissions jsonb not null default '[]'::jsonb,
  allowed_company_ids text[] not null default '{}',
  created_by_portal_user_id uuid not null references public.portal_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_agents_email_per_license unique (license_id, email)
);

create index if not exists support_agents_license_status_idx
  on public.support_agents (license_id, status);

create table if not exists public.support_audit_logs (
  id bigint generated always as identity primary key,
  license_id uuid not null references public.licenses(id) on delete cascade,
  actor_portal_user_id uuid references public.portal_users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists support_audit_logs_license_created_idx
  on public.support_audit_logs (license_id, created_at desc);

-- As consultas são feitas pela API usando a service role; bloquear acesso direto por clientes.
alter table public.support_agents enable row level security;
alter table public.support_audit_logs enable row level security;

-- Sem políticas para anon/authenticated: acesso somente pela API confiável.
