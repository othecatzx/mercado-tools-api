-- ML SH Support: códigos diários da página de Agência do Mercado Livre.
-- Execute este arquivo no SQL Editor do Supabase uma única vez.
create table if not exists public.company_ml_codes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  code_date date not null,
  source text not null default 'extension-agency-page',
  device_id text,
  captured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_ml_codes_company_date_unique unique (company_id, code_date)
);

create index if not exists company_ml_codes_company_date_idx
  on public.company_ml_codes (company_id, code_date desc);

alter table public.company_ml_codes enable row level security;
-- A aplicação acessa esta tabela pelo backend usando SUPABASE_SERVICE_KEY.
-- Não crie políticas públicas para leitura ou gravação.
